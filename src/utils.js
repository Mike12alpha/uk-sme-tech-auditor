/**
 * Helper utilities for domain parsing, directory detection, CSV generation,
 * timestamp formatting, lead quality calculation, and retry logic.
 */

import { parse as tldtsParse } from 'tldts';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { DIRECTORY_DOMAINS, SCORE_LABELS, DECISION_MAKER_TITLES } from './constants.js';

/**
 * Extract a clean root domain from a URL.
 * @param {string} url
 * @returns {string}
 */
export function extractDomain(url) {
    try {
        const parsed = tldtsParse(url, { allowPrivateDomains: true });
        return parsed.domain || new URL(url).hostname;
    } catch {
        return url;
    }
}

/**
 * Determine if a URL points to a known business directory / listing site.
 * @param {string} url
 * @returns {boolean}
 */
export function isDirectoryPage(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return DIRECTORY_DOMAINS.some((domain) => hostname.includes(domain.toLowerCase().trim()));
    } catch {
        return false;
    }
}

/**
 * Format a date as ISO string.
 * @param {Date} [date]
 * @returns {string}
 */
export function formatDate(date = new Date()) {
    return date.toISOString();
}

/**
 * Calculate lead quality label from score.
 * @param {number} score
 * @returns {string}
 */
export function calculateLeadQuality(score) {
    if (score >= 80) return SCORE_LABELS.hot;
    if (score >= 60) return SCORE_LABELS.warm;
    if (score >= 40) return SCORE_LABELS.cold;
    return SCORE_LABELS.ignore;
}

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn
 * @param {number} retries
 * @param {number} baseDelayMs
 * @returns {Promise<any>}
 */
export async function retryAsync(fn, retries = 3, baseDelayMs = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt === retries) break;
            const delay = baseDelayMs * 2 ** attempt + Math.random() * 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

/**
 * Flatten a nested lead object into a CSV-friendly row.
 * @param {Object} item
 * @returns {Object}
 */
function flattenLead(item) {
    const dm = item.decisionMaker || {};
    return {
        url: item.url,
        companyName: item.companyName,
        industry: item.industry,
        companySize: item.companySize,
        techStack: Array.isArray(item.techStack) ? item.techStack.join('; ') : item.techStack,
        lighthousePerformance: item.lighthousePerformance,
        lighthouseSeo: item.lighthouseSeo,
        lighthouseBestPractices: item.lighthouseBestPractices,
        hasSsl: item.hasSsl,
        hasBookingSystem: item.hasBookingSystem,
        hasEcommerce: item.hasEcommerce,
        hasContactForm: item.hasContactForm,
        pageLoadTime: item.pageLoadTime,
        outsourcingScore: item.outsourcingScore,
        leadQuality: calculateLeadQuality(item.outsourcingScore || 0),
        painPoints: Array.isArray(item.painPoints) ? item.painPoints.join('; ') : item.painPoints,
        reasoning: item.reasoning,
        glosixPitchAngle: item.glosixPitchAngle,
        recommendedApproach: item.recommendedApproach,
        decisionMakerName: dm.name || '',
        decisionMakerTitle: dm.title || '',
        decisionMakerLinkedIn: dm.linkedinUrl || '',
        decisionMakerEmail: dm.email || '',
        enrichmentStatus: item.enrichmentStatus,
        scrapedAt: item.scrapedAt,
        actorVersion: item.actorVersion,
    };
}

/**
 * Generate CSV string from an array of lead objects.
 * @param {Object[]} dataset
 * @returns {string}
 */
export function generateCsv(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
        return '';
    }
    const rows = dataset.map(flattenLead);
    return csvStringify(rows, { header: true, columns: Object.keys(rows[0]) });
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract company name from page meta tags or fallback to domain.
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function extractCompanyName(page, url) {
    try {
        const title = await page.locator('meta[property="og:site_name"]').getAttribute('content').catch(() => null)
            || await page.locator('meta[name="application-name"]').getAttribute('content').catch(() => null);
        if (title) return title.trim();

        const pageTitle = await page.title().catch(() => '');
        if (pageTitle) {
            // Common separators: |, -, ::, •
            const cleaned = pageTitle.split(/\s*[|\-–•:·]\s*/)[0].trim();
            if (cleaned && cleaned.length < 80) return cleaned;
        }
    } catch {
        // fall through
    }
    return extractDomain(url);
}

/**
 * Normalize a URL string.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeUrl(raw) {
    try {
        if (!raw.startsWith('http')) return null;
        const url = new URL(raw);
        return url.href;
    } catch {
        return null;
    }
}

/**
 * Basic robots.txt check. Returns false if the URL is explicitly disallowed.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function isAllowedByRobotsTxt(url) {
    try {
        const parsed = new URL(url);
        const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(robotsUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return true;

        const text = await res.text();
        const lines = text.split(/\r?\n/);
        let inWildcardBlock = false;

        for (const rawLine of lines) {
            const line = rawLine.trim().toLowerCase();
            if (line.startsWith('user-agent:')) {
                const ua = line.split(':')[1]?.trim();
                inWildcardBlock = ua === '*';
                continue;
            }
            if (inWildcardBlock && line.startsWith('disallow:')) {
                const path = line.split(':').slice(1).join(':').trim();
                if (path === '/' || parsed.pathname.startsWith(path)) {
                    return false;
                }
            }
        }
        return true;
    } catch {
        return true; // if robots.txt cannot be fetched, proceed
    }
}

export { DECISION_MAKER_TITLES };
