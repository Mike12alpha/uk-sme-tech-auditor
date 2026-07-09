/**
 * Entry point for UK SME Tech Auditor Apify Actor.
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import router from './routes.js';
import { initScorer } from './aiScorer.js';
import { initEnricher, enrichHighScoringLeads } from './enricher.js';
import { generateCsv } from './utils.js';
import { CRAWLER_DEFAULTS } from './constants.js';

// Wappalyzer and Lighthouse each manage their own browser process outside
// Crawlee's control; a stray async operation from an abandoned/reclaimed
// request (e.g. a Chrome DevTools timeout firing after its browser was
// already torn down) can reject after its own try/catch has gone out of
// scope. Without this handler that crashes the whole actor process instead
// of just failing the one request.
process.on('unhandledRejection', (reason) => {
    log.warning(`Unhandled promise rejection (ignored to keep the run alive): ${reason?.stack || reason}`);
});

async function run() {
    await Actor.init();

    const input = await Actor.getInput() || {};

    // Validate required inputs
    if (!input.startUrls || input.startUrls.length === 0) {
        throw new Error('At least one start URL is required.');
    }

    const maxRequests = input.maxRequestsPerCrawl || CRAWLER_DEFAULTS.maxRequestsPerCrawl;
    const minScoreThreshold = input.minScoreThreshold ?? CRAWLER_DEFAULTS.minScoreThreshold;
    const industry = input.industry || 'automotive';
    const companySize = input.companySize || 'SME';
    const outputFormat = input.outputFormat || 'both';

    let enableEnrichment = input.enableEnrichment !== false;
    if (enableEnrichment && !input.proxycurlApiKey) {
        log.warning('enableEnrichment is true but no proxycurlApiKey was provided. Skipping decision-maker enrichment.');
        enableEnrichment = false;
    }

    // Initialize AI scorer and enricher
    await initScorer({ baseUrl: input.ollamaBaseUrl, model: input.ollamaModel });
    if (enableEnrichment) {
        initEnricher(input.proxycurlApiKey);
    }

    // Configure UK residential proxy, falling back to default proxy if the
    // account's plan doesn't include RESIDENTIAL proxy group access.
    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode: 'GB',
        });
    } catch (err) {
        log.warning(`RESIDENTIAL proxy group unavailable on this account (${err.message}). Falling back to default proxy configuration.`);
        proxyConfiguration = await Actor.createProxyConfiguration();
    }

    const crawler = new PlaywrightCrawler({
        requestHandler: (ctx) => router({ ...ctx, industry, companySize }),
        maxRequestsPerCrawl: maxRequests,
        maxConcurrency: CRAWLER_DEFAULTS.maxConcurrency,
        requestHandlerTimeoutSecs: CRAWLER_DEFAULTS.requestTimeoutSeconds,
        proxyConfiguration,
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            },
        },
        browserPoolOptions: {
            useFingerprints: true,
        },
        failedRequestHandler: async ({ request, log }, error) => {
            log.error(`Request ${request.url} failed: ${error.message}`);
        },
    });

    const startUrls = input.startUrls.map((item) => (typeof item === 'string' ? { url: item } : item));
    await crawler.run(startUrls);

    // Enrichment
    if (enableEnrichment) {
        await enrichHighScoringLeads(minScoreThreshold);
    }

    // Generate outputs
    const dataset = await Actor.openDataset();
    const { items: rawItems } = await dataset.getData();

    // Deduplicate by URL, keeping the most recent / enriched record
    const itemsMap = new Map();
    for (const item of rawItems) {
        itemsMap.set(item.url, item);
    }
    const items = Array.from(itemsMap.values());

    if (outputFormat === 'csv' || outputFormat === 'both') {
        const csv = generateCsv(items);
        const key = 'leads.csv';
        await Actor.setValue(key, csv, { contentType: 'text/csv' });
        log.info(`CSV saved to key-value store as ${key}`);
    }

    if (outputFormat === 'json' || outputFormat === 'both') {
        const json = JSON.stringify(items, null, 2);
        await Actor.setValue('leads.json', json, { contentType: 'application/json' });
    }

    // Summary
    const total = items.length;
    const hot = items.filter((i) => i.outsourcingScore >= 80).length;
    const warm = items.filter((i) => i.outsourcingScore >= 60 && i.outsourcingScore < 80).length;
    const cold = items.filter((i) => i.outsourcingScore < 60).length;
    const enriched = items.filter((i) => i.enrichmentStatus === 'enriched').length;

    log.info('=== UK SME Tech Auditor Summary ===');
    log.info(`Total audited: ${total}`);
    log.info(`Hot leads (>=80): ${hot}`);
    log.info(`Warm leads (60-79): ${warm}`);
    log.info(`Cold/Ignore (<60): ${cold}`);
    log.info(`Enriched leads: ${enriched}`);

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
