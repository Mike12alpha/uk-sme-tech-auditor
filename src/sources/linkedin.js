/**
 * LinkedIn people-discovery source.
 *
 * Deliberately does NOT log into LinkedIn or use session cookies — that
 * requires handing over a personal account (high ban risk, and puts the
 * account holder's own ToS exposure on the line). Instead this discovers
 * public profile URLs indexed by DuckDuckGo (`site:linkedin.com/in ...`)
 * and, best-effort, reads the public profile page's Open Graph tags for a
 * bit more detail. Depth is limited to whatever is publicly indexed/visible
 * without authentication — expect fewer fields than a logged-in scraper.
 */

import { CheerioCrawler } from 'crawlee';
import { newLeadId, formatDate, normalizeDdgHref, sleep } from '../utils.js';
import { ACTOR_VERSION, DEFAULT_PERSONA_TITLES } from '../constants.js';

const MAX_QUERIES = 20;

function buildQueries({ personaTitles, keywords, location }) {
    const titles = personaTitles?.length ? personaTitles : DEFAULT_PERSONA_TITLES;
    const kws = keywords?.length ? keywords : [''];
    const queries = [];
    for (const title of titles) {
        for (const kw of kws) {
            const parts = ['site:linkedin.com/in', `"${title}"`, kw, location].filter(Boolean);
            queries.push(parts.join(' '));
            if (queries.length >= MAX_QUERIES) return queries;
        }
    }
    return queries;
}

/** DuckDuckGo/LinkedIn titles are typically "Name - Job Title - Company | LinkedIn". */
function parseTitleParts(title) {
    if (!title) return { name: null, jobTitle: null, company: null };
    const cleaned = title.replace(/\s*[|-]\s*LinkedIn\s*$/i, '').trim();
    const segments = cleaned.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
    return {
        name: segments[0] || null,
        jobTitle: segments[1] || null,
        company: segments[2] || null,
    };
}

export async function runLinkedInSource({
    personaTitles,
    keywords,
    location,
    maxResults,
    proxyConfiguration,
    fetchPublicProfiles = true,
    log: actorLog,
}) {
    const queries = buildQueries({ personaTitles, keywords, location });
    if (!queries.length) return [];

    const leads = [];
    const seen = new Set();

    const searchCrawler = new CheerioCrawler({
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
            if (leads.length >= maxResults) return;
            $('a.result__a').each((_, el) => {
                if (leads.length >= maxResults) return;
                const href = $(el).attr('href');
                const linkedinUrl = normalizeDdgHref(href);
                if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/') || seen.has(linkedinUrl)) return;
                seen.add(linkedinUrl);

                const { name, jobTitle, company } = parseTitleParts($(el).text().trim());
                leads.push({
                    leadId: newLeadId(),
                    source: 'linkedin',
                    type: 'person',
                    companyName: company,
                    personName: name,
                    jobTitle,
                    industry: null,
                    website: null,
                    domain: null,
                    email: null,
                    emailStatus: null,
                    phone: null,
                    address: null,
                    city: location || null,
                    country: null,
                    linkedinUrl,
                    socialLinks: {},
                    rating: null,
                    reviewsCount: null,
                    category: null,
                    sourceUrl: linkedinUrl,
                    scrapedAt: formatDate(),
                    actorVersion: ACTOR_VERSION,
                });
            });
        },
        failedRequestHandler: async ({ request }) => {
            actorLog.warning(`LinkedIn discovery request failed: ${request.url}`);
        },
    });

    await searchCrawler.run(queries.map((q) => ({
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    })));

    if (fetchPublicProfiles && leads.length) {
        // Crawlee persists `userData` as JSON in its request queue, so a lead
        // object stuffed in there and mutated inside the handler is a
        // disconnected clone — edits would silently never reach `leads`.
        // Pass only the serializable `leadId` and look the real object up in
        // this closure-local map instead.
        const leadsById = new Map(leads.map((lead) => [lead.leadId, lead]));

        const profileCrawler = new CheerioCrawler({
            proxyConfiguration,
            maxConcurrency: 2,
            maxRequestRetries: 1,
            maxSessionRotations: 1,
            requestHandlerTimeoutSecs: 20,
            navigationTimeoutSecs: 15,
            maxRequestsPerCrawl: leads.length,
            requestHandler: async ({ $, request }) => {
                const lead = leadsById.get(request.userData.leadId);
                if (!lead) return;

                const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text();
                const ogDesc = $('meta[property="og:description"]').attr('content') || '';

                if (ogTitle) {
                    const { name, jobTitle, company } = parseTitleParts(ogTitle);
                    lead.personName = lead.personName || name;
                    lead.jobTitle = lead.jobTitle || jobTitle;
                    lead.companyName = lead.companyName || company;
                }
                if (ogDesc && !lead.jobTitle) {
                    lead.jobTitle = ogDesc.split('.')[0].slice(0, 120);
                }
            },
            failedRequestHandler: async () => {
                // Login wall or block — keep the snippet-derived data we already have.
            },
        });

        await profileCrawler.run(leads.map((lead) => ({
            url: lead.linkedinUrl,
            userData: { leadId: lead.leadId },
            uniqueKey: lead.leadId,
        })));
    }

    return leads;
}
