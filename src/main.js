/**
 * Entry point for UK SME Tech Auditor Apify Actor.
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import router from './routes.js';
import { initScorer } from './aiScorer.js';
import { initEnricher, enrichHighScoringLeads } from './enricher.js';
import { generateCsv } from './utils.js';
import { CRAWLER_DEFAULTS } from './constants.js';

async function run() {
    await Actor.init();

    const input = await Actor.getInput() || {};

    // Validate required inputs
    if (!input.startUrls || input.startUrls.length === 0) {
        throw new Error('At least one start URL is required.');
    }
    if (input.enableEnrichment !== false && !input.proxycurlApiKey) {
        throw new Error('proxycurlApiKey is required when enableEnrichment is true.');
    }

    const maxRequests = input.maxRequestsPerCrawl || CRAWLER_DEFAULTS.maxRequestsPerCrawl;
    const minScoreThreshold = input.minScoreThreshold ?? CRAWLER_DEFAULTS.minScoreThreshold;
    const industry = input.industry || 'automotive';
    const companySize = input.companySize || 'SME';
    const enableEnrichment = input.enableEnrichment !== false;
    const outputFormat = input.outputFormat || 'both';

    // Initialize AI scorer and enricher
    await initScorer({ baseUrl: input.ollamaBaseUrl, model: input.ollamaModel });
    if (enableEnrichment) {
        initEnricher(input.proxycurlApiKey);
    }

    // Configure UK residential proxy
    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'GB',
    });

    const crawler = new PlaywrightCrawler({
        requestHandler: router,
        requestHandlerContext: { industry, companySize },
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
        Actor.log.info(`CSV saved to key-value store as ${key}`);
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

    Actor.log.info('=== UK SME Tech Auditor Summary ===');
    Actor.log.info(`Total audited: ${total}`);
    Actor.log.info(`Hot leads (>=80): ${hot}`);
    Actor.log.info(`Warm leads (60-79): ${warm}`);
    Actor.log.info(`Cold/Ignore (<60): ${cold}`);
    Actor.log.info(`Enriched leads: ${enriched}`);

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
