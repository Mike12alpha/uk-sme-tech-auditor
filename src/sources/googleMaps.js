/**
 * Google Maps business-listing source.
 *
 * Delegates to compass/crawler-google-places (500k+ users, ~94% success
 * rate) rather than scraping Google Maps directly. Confirmed in production:
 * a raw Playwright scraper through Apify's residential proxy gets its
 * navigation silently tarpitted by Google's anti-bot system (consistent
 * 45s hang, every run, page/browser becoming unresponsive even to a
 * screenshot attempt) — the kind of adversarial target a small actor can't
 * out-engineer. Orchestrating the specialist actor that already solves
 * this is more reliable than fighting Google's bot detection ourselves.
 */

import { Actor } from 'apify';
import { newLeadId, formatDate, extractDomain } from '../utils.js';
import { ACTOR_VERSION } from '../constants.js';

const SOURCE_ACTOR = 'compass/crawler-google-places';

export async function runGoogleMapsSource({ queries, location, maxResultsPerQuery, countryCode, log: actorLog }) {
    const input = {
        searchStringsArray: queries,
        maxCrawledPlacesPerSearch: maxResultsPerQuery,
        language: 'en',
    };
    if (location) input.locationQuery = location;
    if (countryCode) input.countryCode = countryCode.toLowerCase();

    actorLog.info(`Google Maps: delegating to ${SOURCE_ACTOR}...`);

    let run;
    try {
        run = await Actor.call(SOURCE_ACTOR, input, { timeout: 300 });
    } catch (err) {
        actorLog.error(`Google Maps: ${SOURCE_ACTOR} call failed: ${err.message}`);
        return [];
    }

    if (run.status !== 'SUCCEEDED') {
        actorLog.error(`Google Maps: ${SOURCE_ACTOR} run ended with status ${run.status}`);
        return [];
    }

    const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();
    actorLog.info(`Google Maps: ${SOURCE_ACTOR} returned ${items.length} place(s).`);

    return items.map((place) => {
        const website = place.website || null;
        return {
            leadId: newLeadId(),
            source: 'google_maps',
            type: 'company',
            companyName: place.title || null,
            personName: null,
            jobTitle: null,
            industry: null,
            website,
            domain: website ? extractDomain(website) : null,
            email: null,
            emailStatus: null,
            phone: place.phone || place.phoneUnformatted || null,
            address: place.address || null,
            city: place.city || location || null,
            country: place.countryCode ? place.countryCode.toUpperCase() : (countryCode || null),
            linkedinUrl: null,
            socialLinks: {},
            rating: place.totalScore ?? null,
            reviewsCount: place.reviewsCount ?? null,
            category: place.categoryName || null,
            sourceUrl: place.url || null,
            scrapedAt: formatDate(),
            actorVersion: ACTOR_VERSION,
        };
    });
}
