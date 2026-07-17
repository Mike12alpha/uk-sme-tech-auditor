/**
 * Generic company-website discovery via DuckDuckGo web search.
 *
 * This is the catch-all source for "any industry" — it doesn't depend on
 * a platform having a listing for the business, just that the business
 * has a website findable by keyword + location.
 */

import { CheerioCrawler } from 'crawlee';
import { normalizeUrl, extractDomain, isDirectoryPage, newLeadId, formatDate, normalizeDdgHref, sleep } from '../utils.js';
import { ACTOR_VERSION } from '../constants.js';

const SOCIAL_HOSTS = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'pinterest.com'];

export async function runWebSearchSource({ keywords, location, maxResults, proxyConfiguration, log: actorLog }) {
    const queries = (keywords?.length ? keywords : [])
        .map((kw) => [kw, location].filter(Boolean).join(' '))
        .filter(Boolean);
    if (!queries.length) return [];

    const leads = [];
    const seenDomains = new Set();

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestsPerCrawl: queries.length,
        maxRequestRetries: 2,
        maxSessionRotations: 2,
        requestHandlerTimeoutSecs: 30,
        preNavigationHooks: [async ({ request }) => {
            request.headers = { ...request.headers, 'accept-language': 'en-US,en;q=0.9' };
            // DuckDuckGo's HTML endpoint rate-limits bursts of queries from one IP.
            await sleep(1500 + Math.random() * 1500);
        }],
        requestHandler: async ({ $ }) => {
            $('a.result__a').each((_, el) => {
                if (leads.length >= maxResults) return;
                const href = $(el).attr('href');
                const url = normalizeUrl(normalizeDdgHref(href));
                if (!url) return;

                let hostname;
                try {
                    hostname = new URL(url).hostname.toLowerCase();
                } catch {
                    return;
                }
                if (SOCIAL_HOSTS.some((h) => hostname.includes(h))) return;
                if (isDirectoryPage(url)) return;

                const domain = extractDomain(url);
                if (seenDomains.has(domain)) return;
                seenDomains.add(domain);

                leads.push({
                    leadId: newLeadId(),
                    source: 'web_search',
                    type: 'company',
                    companyName: null,
                    personName: null,
                    jobTitle: null,
                    industry: null,
                    website: url,
                    domain,
                    email: null,
                    emailStatus: null,
                    phone: null,
                    address: null,
                    city: location || null,
                    country: null,
                    linkedinUrl: null,
                    socialLinks: {},
                    rating: null,
                    reviewsCount: null,
                    category: null,
                    sourceUrl: url,
                    scrapedAt: formatDate(),
                    actorVersion: ACTOR_VERSION,
                });
            });
        },
        failedRequestHandler: async ({ request }) => {
            actorLog.warning(`Web search request failed: ${request.url}`);
        },
    });

    await crawler.run(queries.map((q) => ({
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    })));

    return leads;
}
