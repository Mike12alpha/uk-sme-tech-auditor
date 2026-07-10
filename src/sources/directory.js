/**
 * Business-directory source: extracts outbound company website links from
 * listing/directory pages (Yell, Thomson Local, etc). Directories are
 * mostly server-rendered so plain HTTP + Cheerio is enough; JS-heavy
 * directories will yield fewer links since we don't execute their scripts.
 */

import { CheerioCrawler } from 'crawlee';
import { normalizeUrl, extractDomain, isDirectoryPage, newLeadId, formatDate } from '../utils.js';
import { ACTOR_VERSION } from '../constants.js';

const SOCIAL_HOSTS = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com'];

function buildDefaultDirectoryUrls(keywords, location) {
    const urls = [];
    for (const kw of keywords || []) {
        urls.push(`https://www.yell.com/ucs/UcsSearchAction.do?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(location || 'UK')}`);
    }
    return urls;
}

export async function runDirectorySource({ directoryUrls, keywords, location, maxResults, proxyConfiguration, log: actorLog }) {
    const startUrls = directoryUrls?.length ? directoryUrls : buildDefaultDirectoryUrls(keywords, location);
    if (!startUrls.length) return [];

    const leads = [];
    const seenDomains = new Set();

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 2,
        maxRequestsPerCrawl: startUrls.length,
        requestHandlerTimeoutSecs: 30,
        requestHandler: async ({ $, request }) => {
            let hostname;
            try {
                hostname = new URL(request.loadedUrl || request.url).hostname.toLowerCase();
            } catch {
                return;
            }

            $('a[href^="http"]').each((_, el) => {
                if (leads.length >= maxResults) return;
                const href = $(el).attr('href');
                const url = normalizeUrl(href);
                if (!url) return;

                let linkHost;
                try {
                    linkHost = new URL(url).hostname.toLowerCase();
                } catch {
                    return;
                }
                if (linkHost === hostname) return;
                if (isDirectoryPage(url)) return;
                if (SOCIAL_HOSTS.some((h) => linkHost.includes(h))) return;

                const domain = extractDomain(url);
                if (seenDomains.has(domain)) return;
                seenDomains.add(domain);

                leads.push({
                    leadId: newLeadId(),
                    source: 'directory',
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
                    sourceUrl: request.url,
                    scrapedAt: formatDate(),
                    actorVersion: ACTOR_VERSION,
                });
            });
        },
        failedRequestHandler: async ({ request }) => {
            actorLog.warning(`Directory request failed: ${request.url}`);
        },
    });

    await crawler.run(startUrls);
    return leads;
}
