/**
 * Generic helpers shared across all lead sources: domain/email/phone
 * extraction, CSV export, retry/backoff, and lightweight compliance checks.
 */

import { randomUUID } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';
import { parse as tldtsParse } from 'tldts';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { DIRECTORY_DOMAINS, calculateLeadQuality, FREE_EMAIL_PROVIDERS, NON_BUSINESS_DOMAINS } from './constants.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// UK-biased but tolerant of loose international formats (spaces, dashes, parens, leading +).
const PHONE_REGEX = /(\+?\d{1,3}[\s.-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

export function extractDomain(url) {
    try {
        const parsed = tldtsParse(url, { allowPrivateDomains: true });
        return parsed.domain || new URL(url).hostname;
    } catch {
        return url;
    }
}

export function isDirectoryPage(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return DIRECTORY_DOMAINS.some((domain) => hostname.includes(domain.toLowerCase().trim()));
    } catch {
        return false;
    }
}

export function formatDate(date = new Date()) {
    return date.toISOString();
}

export async function retryAsync(fn, retries = 3, baseDelayMs = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt === retries) break;
            const delay = baseDelayMs * 2 ** attempt + Math.random() * 500;
            await sleep(delay);
        }
    }
    throw lastError;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeUrl(raw) {
    try {
        if (!raw || !raw.startsWith('http')) return null;
        const url = new URL(raw);
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
}

/**
 * Basic robots.txt check. Returns false only if the path is explicitly
 * disallowed for all user agents; fails open (true) on any fetch error.
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
                if (path === '/' || (path && parsed.pathname.startsWith(path))) {
                    return false;
                }
            }
        }
        return true;
    } catch {
        return true;
    }
}

// Flattening DOM text runs adjacent inline elements together with no
// separator (e.g. a phone extension right before an email), and digits are
// technically valid in an email local-part — so a run like
// "6600info@x.com" parses as one token. Strip a leading digit run followed
// by letters; real local-parts starting that way are rare.
function stripLeadingDigitNoise(email) {
    return email.replace(/^\d+(?=[a-z])/, '');
}

export function extractEmails(text) {
    if (!text) return [];
    const matches = text.match(EMAIL_REGEX) || [];
    return [...new Set(matches.map((e) => stripLeadingDigitNoise(e.toLowerCase())))]
        .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e));
}

/** Highest-confidence email source: explicit `mailto:` links. */
export function extractMailtoEmails(html) {
    if (!html) return [];
    const matches = [...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1].toLowerCase().trim());
    return [...new Set(matches)];
}

export function extractPhones(text) {
    if (!text) return [];
    const matches = text.match(PHONE_REGEX) || [];
    return [...new Set(matches
        .map((p) => p.trim())
        .filter((p) => p.replace(/\D/g, '').length >= 7))];
}

export function extractSocialLinks(html) {
    const links = { facebook: null, twitter: null, instagram: null, linkedin: null };
    if (!html) return links;
    const patterns = {
        facebook: /https?:\/\/(www\.)?facebook\.com\/[^"'\s)<]+/i,
        twitter: /https?:\/\/(www\.)?(twitter|x)\.com\/[^"'\s)<]+/i,
        instagram: /https?:\/\/(www\.)?instagram\.com\/[^"'\s)<]+/i,
        linkedin: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[^"'\s)<]+/i,
    };
    for (const [key, regex] of Object.entries(patterns)) {
        const match = html.match(regex);
        if (match) links[key] = match[0];
    }
    return links;
}

/**
 * Generate plausible work-email patterns from a name and domain.
 * These are guesses, not confirmed addresses — callers should mark them
 * as `emailStatus: 'guessed'` and pair them with `domainHasMx` for a
 * cheap sanity signal.
 */
export function generateEmailPatterns(firstName, lastName, domain) {
    if (!firstName || !domain) return [];
    const f = firstName.toLowerCase().replace(/[^a-z-]/g, '');
    const l = (lastName || '').toLowerCase().replace(/[^a-z-]/g, '');
    if (!f) return [];
    const patterns = [`${f}@${domain}`];
    if (l) {
        patterns.push(
            `${f}.${l}@${domain}`,
            `${f}${l}@${domain}`,
            `${f[0]}${l}@${domain}`,
            `${f}.${l[0]}@${domain}`,
            `${l}@${domain}`,
        );
    }
    return [...new Set(patterns)];
}

/** Cheap deliverability signal: does the domain even have mail servers? */
export async function domainHasMx(domain) {
    try {
        const records = await resolveMx(domain);
        return records.length > 0;
    } catch {
        return false;
    }
}

export function isFreeEmailProvider(email) {
    const domain = (email || '').split('@')[1]?.toLowerCase();
    return FREE_EMAIL_PROVIDERS.includes(domain);
}

/** True if the URL/host is a search engine, aggregator, or reference site — never a real business lead. */
export function isNonBusinessUrl(url) {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return NON_BUSINESS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

/** A lead is "contactable" if it has at least one of email, phone, or website. */
export function leadHasContact(lead) {
    return !!(lead.email || lead.phone || lead.website);
}

export function newLeadId() {
    return randomUUID();
}

/**
 * DuckDuckGo's HTML endpoint sometimes wraps result links in a redirect
 * (`//duckduckgo.com/l/?uddg=<encoded target>`) instead of linking directly.
 * Unwrap that so downstream code always gets the real destination URL.
 */
export function normalizeDdgHref(href) {
    if (!href) return null;
    try {
        if (href.includes('uddg=')) {
            const url = new URL(href, 'https://duckduckgo.com');
            // URLSearchParams.get() already percent-decodes the value.
            const target = url.searchParams.get('uddg');
            if (target) return target.split('?')[0];
        }
        return href.split('?')[0];
    } catch {
        return null;
    }
}

/** Run `mapper` over `items` with at most `concurrency` in flight at once. */
export async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const current = index++;
            results[current] = await mapper(items[current], current);
        }
    }
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
    await Promise.all(workers);
    return results;
}

/**
 * Flatten a unified lead record into a CSV-friendly row.
 */
function flattenLead(item) {
    const social = item.socialLinks || {};
    return {
        leadId: item.leadId,
        source: item.source,
        type: item.type,
        companyName: item.companyName || '',
        personName: item.personName || '',
        jobTitle: item.jobTitle || '',
        industry: item.industry || '',
        website: item.website || '',
        domain: item.domain || '',
        email: item.email || '',
        emailStatus: item.emailStatus || '',
        phone: item.phone || '',
        address: item.address || '',
        postcode: item.postcode || '',
        city: item.city || '',
        country: item.country || '',
        latitude: item.latitude ?? '',
        longitude: item.longitude ?? '',
        linkedinUrl: item.linkedinUrl || '',
        facebook: social.facebook || '',
        twitter: social.twitter || '',
        instagram: social.instagram || '',
        rating: item.rating ?? '',
        reviewsCount: item.reviewsCount ?? '',
        category: item.category || '',
        icpScore: item.icpScore ?? '',
        leadQuality: item.leadQuality || (item.icpScore != null ? calculateLeadQuality(item.icpScore) : ''),
        matchedPersona: item.matchedPersona ?? '',
        icpReasoning: item.icpReasoning || '',
        suggestedApproach: item.suggestedApproach || '',
        sourceUrl: item.sourceUrl || '',
        scrapedAt: item.scrapedAt || '',
        actorVersion: item.actorVersion || '',
    };
}

export function generateCsv(dataset) {
    if (!Array.isArray(dataset) || dataset.length === 0) return '';
    const rows = dataset.map(flattenLead);
    return csvStringify(rows, { header: true, columns: Object.keys(rows[0]) });
}
