/**
 * Decision-maker enrichment using Proxycurl LinkedIn API.
 * Rate-limited to respect Proxycurl limits.
 */

import { Actor } from 'apify';
import { retryAsync, extractDomain, sleep } from './utils.js';
import { DECISION_MAKER_TITLES } from './constants.js';

const PROXYCURL_SEARCH_URL = 'https://nubela.co/proxycurl/api/linkedin/company/employee/search/';
const REQUESTS_PER_MINUTE = 10;
const DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE); // ~6000ms

let apiKey = null;

/**
 * Initialize enricher with Proxycurl API key.
 * @param {string} key
 */
export function initEnricher(key) {
    if (!key) throw new Error('Proxycurl API key is required when enrichment is enabled.');
    apiKey = key;
}

/**
 * Call Proxycurl employee search for a company website.
 * @param {string} companyWebsite
 * @returns {Promise<Object|null>}
 */
async function fetchDecisionMakers(companyWebsite) {
    if (!apiKey) return null;

    const body = {
        url: companyWebsite,
        keyword: '',
        role: '',
        page_size: 10,
        enrich_profile: 'enrich',
    };

    const response = await retryAsync(async () => {
        const res = await fetch(PROXYCURL_SEARCH_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Proxycurl HTTP ${res.status}: ${text}`);
        }
        return res.json();
    }, 2);

    if (!response?.employees || response.employees.length === 0) return null;

    // Find best matching decision maker
    const match = response.employees.find((emp) => {
        const title = (emp.profile?.occupation || emp.profile?.headline || '').toLowerCase();
        return DECISION_MAKER_TITLES.some((t) => title.includes(t.toLowerCase()));
    }) || response.employees[0];

    const profile = match.profile || {};
    const person = profile.person || {};

    return {
        name: person.full_name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || null,
        title: profile.occupation || profile.headline || null,
        linkedinUrl: profile.linkedin_profile_url || person.linkedin_profile_url || null,
        email: person.work_email || person.personal_email || null,
    };
}

/**
 * Enrich high-scoring leads in the dataset.
 * @param {number} minScoreThreshold
 * @returns {Promise<number>} number of enriched leads
 */
export async function enrichHighScoringLeads(minScoreThreshold) {
    const dataset = await Actor.openDataset();
    const { items } = await dataset.getData();

    const highScorers = items.filter((item) => (item.outsourcingScore || 0) >= minScoreThreshold);
    Actor.log.info(`Enrichment: ${highScorers.length} leads match threshold ${minScoreThreshold}.`);

    let enrichedCount = 0;

    for (const item of highScorers) {
        try {
            const dm = await fetchDecisionMakers(item.url);
            if (dm?.name) {
                item.decisionMaker = dm;
                item.enrichmentStatus = 'enriched';
                enrichedCount++;
            } else {
                item.decisionMaker = null;
                item.enrichmentStatus = 'pending';
            }

            // Persist update back to dataset by pushing corrected item
            await dataset.pushData(item);
        } catch (err) {
            Actor.log.warning(`Enrichment failed for ${item.url}: ${err.message}`);
            item.decisionMaker = null;
            item.enrichmentStatus = 'pending';
            await dataset.pushData(item);
        }

        await sleep(DELAY_MS);
    }

    Actor.log.info(`Enrichment complete: ${enrichedCount}/${highScorers.length} leads enriched.`);
    return enrichedCount;
}
