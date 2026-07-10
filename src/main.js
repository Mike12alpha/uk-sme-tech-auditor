/**
 * Entry point for the Universal Lead Generator Apify Actor.
 *
 * Orchestrates independent lead sources (Google Maps, LinkedIn, business
 * directories, generic web search), merges/dedupes what they find, enriches
 * companies with contact data from their own websites, scores every lead
 * against the caller's free-text ICP with Claude, and exports the result.
 */

import { Actor, log } from 'apify';
import { runGoogleMapsSource } from './sources/googleMaps.js';
import { runLinkedInSource } from './sources/linkedin.js';
import { runDirectorySource } from './sources/directory.js';
import { runWebSearchSource } from './sources/webSearch.js';
import { enrichWebsites } from './sources/website.js';
import { initScorer, scoreLead } from './scorer.js';
import { dedupeAndMergeLeads } from './dedupe.js';
import { generateCsv, mapWithConcurrency } from './utils.js';
import { CRAWLER_DEFAULTS, SOURCES } from './constants.js';

// Each source manages its own browser/HTTP client outside Crawlee's direct
// control; a stray async operation from an abandoned request can reject
// after its own try/catch has gone out of scope. Without this handler that
// crashes the whole actor process instead of just failing the one request.
process.on('unhandledRejection', (reason) => {
    log.warning(`Unhandled promise rejection (ignored to keep the run alive): ${reason?.stack || reason}`);
});

async function run() {
    await Actor.init();
    const input = await Actor.getInput() || {};

    const icpDescription = input.icpDescription?.trim();
    if (!icpDescription) {
        throw new Error('icpDescription is required — describe your ideal customer profile (industry, persona, company size, region, etc).');
    }

    const enabledSources = input.sources?.length ? input.sources : Object.values(SOURCES);
    const searchQueries = input.searchQueries || [];
    const keywords = input.keywords?.length ? input.keywords : searchQueries;
    const personaTitles = input.personaTitles?.length ? input.personaTitles : undefined;
    const location = input.location || '';
    const countryCode = input.countryCode || undefined;
    const maxResultsPerSource = input.maxResultsPerSource || CRAWLER_DEFAULTS.maxResultsPerSource;
    const minScoreThreshold = input.minScoreThreshold ?? CRAWLER_DEFAULTS.minScoreThreshold;
    const outputFormat = input.outputFormat || 'both';
    const doEnrichWebsites = input.enrichWebsites !== false;
    const fetchLinkedInPublicProfiles = input.fetchLinkedInPublicProfiles !== false;

    if (enabledSources.includes(SOURCES.GOOGLE_MAPS) && !searchQueries.length) {
        log.warning('Google Maps source is enabled but no searchQueries were provided — skipping Google Maps.');
    }

    initScorer({ apiKey: input.anthropicApiKey, model: input.anthropicModel });
    if (!input.anthropicApiKey) {
        log.warning('No anthropicApiKey provided — leads will be scored with a rule-based fallback instead of Claude.');
    }

    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode,
        });
    } catch (err) {
        log.warning(`RESIDENTIAL proxy group unavailable on this account (${err.message}). Falling back to default proxy configuration.`);
        proxyConfiguration = await Actor.createProxyConfiguration();
    }

    let leads = [];

    if (enabledSources.includes(SOURCES.GOOGLE_MAPS) && searchQueries.length) {
        log.info('Running Google Maps source...');
        const mapsLeads = await runGoogleMapsSource({
            queries: searchQueries,
            location,
            maxResultsPerQuery: maxResultsPerSource,
            proxyConfiguration,
            countryCode,
            log,
        }).catch((err) => {
            log.error(`Google Maps source failed: ${err.message}`);
            return [];
        });
        log.info(`Google Maps: ${mapsLeads.length} leads.`);
        leads.push(...mapsLeads);
    }

    if (enabledSources.includes(SOURCES.LINKEDIN)) {
        log.info('Running LinkedIn source...');
        const linkedinLeads = await runLinkedInSource({
            personaTitles,
            keywords,
            location,
            maxResults: maxResultsPerSource,
            proxyConfiguration,
            fetchPublicProfiles: fetchLinkedInPublicProfiles,
            log,
        }).catch((err) => {
            log.error(`LinkedIn source failed: ${err.message}`);
            return [];
        });
        log.info(`LinkedIn: ${linkedinLeads.length} leads.`);
        leads.push(...linkedinLeads);
    }

    if (enabledSources.includes(SOURCES.DIRECTORY)) {
        log.info('Running directory source...');
        const directoryLeads = await runDirectorySource({
            directoryUrls: input.directoryUrls,
            keywords,
            location,
            maxResults: maxResultsPerSource,
            proxyConfiguration,
            log,
        }).catch((err) => {
            log.error(`Directory source failed: ${err.message}`);
            return [];
        });
        log.info(`Directory: ${directoryLeads.length} leads.`);
        leads.push(...directoryLeads);
    }

    if (enabledSources.includes(SOURCES.WEB_SEARCH)) {
        log.info('Running web search source...');
        const webSearchLeads = await runWebSearchSource({
            keywords,
            location,
            maxResults: maxResultsPerSource,
            proxyConfiguration,
            log,
        }).catch((err) => {
            log.error(`Web search source failed: ${err.message}`);
            return [];
        });
        log.info(`Web search: ${webSearchLeads.length} leads.`);
        leads.push(...webSearchLeads);
    }

    log.info(`Total raw leads collected: ${leads.length}`);
    leads = dedupeAndMergeLeads(leads);
    log.info(`After cross-source dedupe/merge: ${leads.length} leads.`);

    if (doEnrichWebsites) {
        log.info('Enriching leads with contact data from their websites...');
        leads = await enrichWebsites(leads, { proxyConfiguration, log });
    }

    log.info('Scoring leads against the ICP...');
    await mapWithConcurrency(leads, 5, async (lead) => {
        const result = await scoreLead(lead, icpDescription);
        lead.icpScore = result.score;
        lead.matchedPersona = result.matchedPersona;
        lead.icpReasoning = result.reasoning;
        lead.suggestedApproach = result.suggestedApproach;
    });

    const qualifiedLeads = leads.filter((l) => (l.icpScore ?? 0) >= minScoreThreshold);
    log.info(`${qualifiedLeads.length}/${leads.length} leads meet the minimum score threshold (${minScoreThreshold}).`);

    for (const lead of qualifiedLeads) {
        await Actor.pushData(lead);
    }

    if (outputFormat === 'csv' || outputFormat === 'both') {
        const csv = generateCsv(qualifiedLeads);
        await Actor.setValue('leads.csv', csv, { contentType: 'text/csv' });
        log.info('CSV saved to key-value store as leads.csv');
    }
    if (outputFormat === 'json' || outputFormat === 'both') {
        await Actor.setValue('leads.json', JSON.stringify(qualifiedLeads, null, 2), { contentType: 'application/json' });
    }

    const hot = qualifiedLeads.filter((l) => l.icpScore >= 80).length;
    const warm = qualifiedLeads.filter((l) => l.icpScore >= 60 && l.icpScore < 80).length;
    const cold = qualifiedLeads.filter((l) => l.icpScore < 60).length;

    log.info('=== Universal Lead Generator Summary ===');
    log.info(`Total leads scraped: ${leads.length}`);
    log.info(`Qualified leads (>= threshold): ${qualifiedLeads.length}`);
    log.info(`Hot (>=80): ${hot} | Warm (60-79): ${warm} | Cold (<60): ${cold}`);

    await Actor.exit();
}

run().catch(async (err) => {
    console.error(err);
    try {
        await Actor.fail(err.message);
    } catch {
        // Actor may not have initialized
    }
    process.exit(1);
});
