/**
 * Entry point for the Universal Lead Generator Apify Actor.
 *
 * Orchestrates independent lead sources (Google Maps, LinkedIn, business
 * directories, generic web search), merges/dedupes what they find, enriches
 * companies with contact data from their own websites, scores every lead
 * against the caller's free-text ICP with Groq, and exports the result.
 */

import { Actor, log } from 'apify';
import { runLocalBusinessSource } from './sources/localBusiness.js';
import { runLinkedInSource } from './sources/linkedin.js';
import { runDirectorySource } from './sources/directory.js';
import { runWebSearchSource } from './sources/webSearch.js';
import { enrichWebsites } from './sources/website.js';
import { initScorer, scoreLead } from './scorer.js';
import { dedupeAndMergeLeads } from './dedupe.js';
import { generateCsv, mapWithConcurrency } from './utils.js';
import { CRAWLER_DEFAULTS, SOURCES, SOURCE_ALIASES } from './constants.js';
import {
    callApifyActor,
    buildMapsActorInput, mapMapsPlace,
    buildLinkedInActorInput, mapLinkedInProfile,
    buildDirectoryActorInput, mapDirectoryItem,
} from './apifyActors.js';

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

    // Normalize any legacy source ids (e.g. "googleMaps" → "localBusiness")
    // so older saved inputs keep working after the rename.
    const enabledSources = (input.sources?.length ? input.sources : Object.values(SOURCES))
        .map((s) => SOURCE_ALIASES[s] || s);
    const searchQueries = input.searchQueries || [];
    const keywords = input.keywords?.length ? input.keywords : searchQueries;
    // The local business source is the most reliable one, so let it run on
    // whichever of the two "what to look for" fields the user actually filled
    // in — searchQueries preferred, else keywords.
    const localBusinessQueries = searchQueries.length ? searchQueries : keywords;
    const personaTitles = input.personaTitles?.length ? input.personaTitles : undefined;
    const location = input.location || '';
    const countryCode = input.countryCode || undefined;
    const maxResultsPerSource = input.maxResultsPerSource || CRAWLER_DEFAULTS.maxResultsPerSource;
    const minScoreThreshold = input.minScoreThreshold ?? CRAWLER_DEFAULTS.minScoreThreshold;
    const outputFormat = input.outputFormat || 'both';
    const doEnrichWebsites = input.enrichWebsites !== false;
    const fetchLinkedInPublicProfiles = input.fetchLinkedInPublicProfiles !== false;

    // External Apify Actors (paid, require a plan that can run public Actors).
    // When enabled and an id is set for a source, we try that Actor first and
    // fall back to our own crawler if it can't run or returns nothing.
    const useApifyActors = input.useApifyActors === true;
    const mapsActorId = useApifyActors ? (input.mapsActorId || 'compass/crawler-google-places') : '';
    const linkedinActorId = useApifyActors ? (input.linkedinActorId || 'harvestapi/linkedin-profile-search') : '';
    const directoryActorId = useApifyActors ? (input.directoryActorId || '') : '';
    if (useApifyActors) {
        log.info('External Apify Actors are ENABLED — will try them first, falling back to built-in crawlers on failure. (Requires a plan that can run public Actors; these Actors are billed per result.)');
    }

    if (enabledSources.includes(SOURCES.LOCAL_BUSINESS) && !localBusinessQueries.length) {
        log.warning('Local business source is enabled but neither `searchQueries` nor `keywords` was provided — skipping it. This is usually the most productive source, so add e.g. searchQueries: ["dental clinics"] and a location.');
    }
    if (localBusinessQueries.length && !location) {
        log.warning('Search terms were given but no `location` — the local business source needs a location (e.g. "London, UK") to run.');
    }

    // The key can come from the input's secret field or, so it can be set
    // once and reused across runs without living in the repo, from a
    // GROQ_API_KEY environment variable (set it as an encrypted secret in
    // the Actor's Settings → Environment variables).
    const groqApiKey = input.groqApiKey || process.env.GROQ_API_KEY;
    initScorer({ apiKey: groqApiKey, model: input.groqModel });
    if (!groqApiKey) {
        log.warning('No Groq API key (input groqApiKey or GROQ_API_KEY env var) — leads will be scored with a rule-based fallback instead of an LLM.');
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

    if (enabledSources.includes(SOURCES.LOCAL_BUSINESS) && localBusinessQueries.length) {
        let localLeads = [];

        if (mapsActorId) {
            log.info(`Local business: trying external Actor ${mapsActorId}...`);
            const items = await callApifyActor(
                mapsActorId,
                buildMapsActorInput({ queries: localBusinessQueries, location, maxResultsPerQuery: maxResultsPerSource, countryCode }),
                log,
            );
            if (items?.length) {
                localLeads = items.map((place) => mapMapsPlace(place, { location, countryCode }));
                log.info(`Local business: external Actor returned ${localLeads.length} leads.`);
            }
        }

        if (!localLeads.length) {
            log.info('Running local business (OpenStreetMap) source...');
            localLeads = await runLocalBusinessSource({
                queries: localBusinessQueries,
                location,
                maxResultsPerQuery: maxResultsPerSource,
                countryCode,
                log,
            }).catch((err) => {
                log.error(`Local business source failed: ${err.message}`);
                return [];
            });
        }
        log.info(`Local business: ${localLeads.length} leads.`);
        leads.push(...localLeads);
    }

    if (enabledSources.includes(SOURCES.LINKEDIN)) {
        let linkedinLeads = [];

        if (linkedinActorId) {
            log.info(`LinkedIn: trying external Actor ${linkedinActorId}...`);
            const items = await callApifyActor(
                linkedinActorId,
                buildLinkedInActorInput({ keywords, personaTitles, location, maxResults: maxResultsPerSource }),
                log,
            );
            if (items?.length) {
                linkedinLeads = items.map((item) => mapLinkedInProfile(item, { location }));
                log.info(`LinkedIn: external Actor returned ${linkedinLeads.length} leads.`);
            }
        }

        if (!linkedinLeads.length) {
            log.info('Running LinkedIn source (built-in)...');
            linkedinLeads = await runLinkedInSource({
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
        }
        log.info(`LinkedIn: ${linkedinLeads.length} leads.`);
        leads.push(...linkedinLeads);
    }

    if (enabledSources.includes(SOURCES.DIRECTORY)) {
        let directoryLeads = [];

        if (directoryActorId) {
            log.info(`Directory: trying external Actor ${directoryActorId}...`);
            const items = await callApifyActor(
                directoryActorId,
                buildDirectoryActorInput({ directoryUrls: input.directoryUrls, keywords, location, maxResults: maxResultsPerSource }),
                log,
            );
            if (items?.length) {
                directoryLeads = items.map((item) => mapDirectoryItem(item, { location, countryCode }));
                log.info(`Directory: external Actor returned ${directoryLeads.length} leads.`);
            }
        }

        if (!directoryLeads.length) {
            log.info('Running directory source (built-in)...');
            directoryLeads = await runDirectorySource({
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
        }
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
    if (leads.length === 0) {
        log.warning('No leads from any source. The most reliable source is Local business (OpenStreetMap): make sure you passed `searchQueries` (e.g. ["dental clinics"]) AND a `location` (e.g. "London, UK"). The LinkedIn/directory/web-search sources are frequently blocked on this plan (see README) and often return nothing on their own.');
    }
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

// Seen in production: `Actor.init()`/`Actor.getInput()` can throw this exact
// TypeError deep inside the `apify` SDK's own platform self-check, before our
// code ever runs — reproduced consistently under the platform's default
// "LIMITED_PERMISSIONS" run mode. It is not something our code triggers or
// can catch/retry around (the SDK marks itself initialized before the step
// that fails, so retrying in-process is a no-op). If you see this, try
// switching the Actor's permission level to Full permissions in Console
// (Settings tab) — that's the only known workaround so far.
const KNOWN_SDK_INIT_BUG_SIGNATURE = "Cannot read properties of undefined (reading 'warning')";

run().catch(async (err) => {
    console.error(err);
    if (err.message === KNOWN_SDK_INIT_BUG_SIGNATURE) {
        console.error([
            '',
            'This matches a known apify-SDK-internal failure during Actor.init()/getInput(),',
            'observed under the platform\'s default "LIMITED_PERMISSIONS" run mode.',
            'It originates inside the apify npm package itself, not this actor\'s code.',
            'Workaround: Console -> this Actor -> Settings -> Actor permissions -> Full permissions.',
            '',
        ].join('\n'));
    }
    try {
        await Actor.fail(err.message);
    } catch {
        // Actor may not have initialized
    }
    process.exit(1);
});
