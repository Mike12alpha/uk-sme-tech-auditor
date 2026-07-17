/**
 * Optional orchestration of external, pre-built Apify Actors (Google Maps,
 * LinkedIn, directories) as richer alternatives to our own crawlers.
 *
 * IMPORTANT: running public Actors requires an Apify plan that permits it.
 * On restricted/free plans, Actor.call() fails with "your plan does not
 * support running public Actors" — every function here returns null on any
 * failure so the caller can fall back to our own crawler. External Actors
 * are also PAID (a few cents per result), billed to your account separately.
 *
 * The compass (Google Maps) mapping is against that Actor's documented
 * output schema. The LinkedIn and directory mappings are intentionally
 * defensive (they probe several possible field names) because those Actors'
 * output shapes vary and can't be verified without a plan that can run them.
 */

import { Actor } from 'apify';
import { newLeadId, formatDate, extractDomain, normalizeUrl } from './utils.js';
import { ACTOR_VERSION } from './constants.js';

const CALL_TIMEOUT_SECS = 300;

/** Run an external Actor and return its default-dataset items, or null on any failure. */
export async function callApifyActor(actorId, input, log) {
    let run;
    try {
        run = await Actor.call(actorId, input, { timeout: CALL_TIMEOUT_SECS });
    } catch (err) {
        log.warning(`External Actor ${actorId} could not be run (${err.message}). Falling back to built-in crawler.`);
        return null;
    }
    if (!run || run.status !== 'SUCCEEDED') {
        log.warning(`External Actor ${actorId} ended with status ${run?.status || 'unknown'}. Falling back to built-in crawler.`);
        return null;
    }
    try {
        const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();
        return items || [];
    } catch (err) {
        log.warning(`Could not read ${actorId} output dataset (${err.message}). Falling back to built-in crawler.`);
        return null;
    }
}

function firstNonEmpty(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Google Maps — compass/crawler-google-places
// ---------------------------------------------------------------------------

export function buildMapsActorInput({ queries, location, maxResultsPerQuery, countryCode }) {
    const input = {
        searchStringsArray: queries,
        maxCrawledPlacesPerSearch: maxResultsPerQuery,
        language: 'en',
    };
    if (location) input.locationQuery = location;
    if (countryCode) input.countryCode = countryCode.toLowerCase();
    return input;
}

export function mapMapsPlace(place, { location, countryCode }) {
    const website = firstNonEmpty(place.website, place.url && !/google\./i.test(place.url) ? null : null);
    const site = place.website ? normalizeUrl(place.website) : null;
    return {
        leadId: newLeadId(),
        source: 'google_maps',
        type: 'company',
        companyName: firstNonEmpty(place.title, place.name),
        personName: null,
        jobTitle: null,
        industry: null,
        website: site,
        domain: site ? extractDomain(site) : null,
        email: firstNonEmpty(place.email, place.emails?.[0]) ? String(firstNonEmpty(place.email, place.emails?.[0])).toLowerCase() : null,
        emailStatus: firstNonEmpty(place.email, place.emails?.[0]) ? 'found' : null,
        phone: firstNonEmpty(place.phone, place.phoneUnformatted),
        address: firstNonEmpty(place.address, place.street),
        city: firstNonEmpty(place.city, location),
        country: place.countryCode ? String(place.countryCode).toUpperCase() : (countryCode || null),
        linkedinUrl: null,
        socialLinks: {},
        rating: firstNonEmpty(place.totalScore, place.rating),
        reviewsCount: firstNonEmpty(place.reviewsCount, place.reviews),
        category: firstNonEmpty(place.categoryName, place.category),
        sourceUrl: firstNonEmpty(place.url, place.searchPageUrl),
        scrapedAt: formatDate(),
        actorVersion: ACTOR_VERSION,
    };
}

// ---------------------------------------------------------------------------
// LinkedIn — harvestapi/linkedin-profile-search (defensive mapping)
// ---------------------------------------------------------------------------

export function buildLinkedInActorInput({ keywords, personaTitles, location, maxResults }) {
    const input = { maxItems: maxResults };
    const searchQuery = [personaTitles?.join(' OR '), keywords?.join(' ')].filter(Boolean).join(' ').trim();
    if (searchQuery) input.searchQuery = searchQuery;
    if (personaTitles?.length) input.currentJobTitles = personaTitles;
    if (location) input.locations = [location];
    return input;
}

export function mapLinkedInProfile(item, { location }) {
    const name = firstNonEmpty(
        item.name, item.fullName,
        [item.firstName, item.lastName].filter(Boolean).join(' ') || null,
    );
    const jobTitle = firstNonEmpty(
        item.headline, item.jobTitle, item.position, item.title,
        item.currentPosition?.title, item.experience?.[0]?.title, item.experience?.[0]?.position,
    );
    const company = firstNonEmpty(
        item.companyName, item.company?.name, item.currentCompany?.name,
        item.currentPosition?.companyName, item.experience?.[0]?.companyName, item.experience?.[0]?.company,
    );
    const linkedinUrl = firstNonEmpty(item.linkedinUrl, item.profileUrl, item.url, item.publicProfileUrl, item.profileLink);
    const email = firstNonEmpty(item.email, item.workEmail, item.emailAddress, item.emails?.[0]);

    return {
        leadId: newLeadId(),
        source: 'linkedin',
        type: 'person',
        companyName: company,
        personName: name,
        jobTitle,
        industry: firstNonEmpty(item.industry, item.industryName),
        website: null,
        domain: null,
        email: email ? String(email).toLowerCase() : null,
        emailStatus: email ? 'found' : null,
        phone: firstNonEmpty(item.phone, item.phoneNumber),
        address: null,
        city: firstNonEmpty(item.location, item.locationName, item.geoLocation, location),
        country: firstNonEmpty(item.country, item.countryName),
        linkedinUrl,
        socialLinks: {},
        rating: null,
        reviewsCount: null,
        category: null,
        sourceUrl: linkedinUrl,
        scrapedAt: formatDate(),
        actorVersion: ACTOR_VERSION,
    };
}

// ---------------------------------------------------------------------------
// Directory — user-supplied Actor id (generic defensive mapping)
// ---------------------------------------------------------------------------

export function buildDirectoryActorInput({ directoryUrls, keywords, location, maxResults }) {
    const input = { maxItems: maxResults };
    if (directoryUrls?.length) input.startUrls = directoryUrls.map((url) => ({ url }));
    if (keywords?.length) input.search = keywords.join(' ');
    if (location) input.location = location;
    return input;
}

export function mapDirectoryItem(item, { location, countryCode }) {
    const rawSite = firstNonEmpty(item.website, item.url, item.link, item.domain, item.companyWebsite);
    const site = rawSite ? normalizeUrl(rawSite.startsWith('http') ? rawSite : `https://${rawSite}`) : null;
    const email = firstNonEmpty(item.email, item.emails?.[0], item.contactEmail);
    return {
        leadId: newLeadId(),
        source: 'directory',
        type: 'company',
        companyName: firstNonEmpty(item.name, item.title, item.companyName, item.businessName),
        personName: null,
        jobTitle: null,
        industry: firstNonEmpty(item.category, item.industry),
        website: site,
        domain: site ? extractDomain(site) : null,
        email: email ? String(email).toLowerCase() : null,
        emailStatus: email ? 'found' : null,
        phone: firstNonEmpty(item.phone, item.phoneNumber, item.telephone),
        address: firstNonEmpty(item.address, item.fullAddress),
        city: firstNonEmpty(item.city, location),
        country: firstNonEmpty(item.country, countryCode),
        linkedinUrl: firstNonEmpty(item.linkedin, item.linkedinUrl),
        socialLinks: {},
        rating: firstNonEmpty(item.rating, item.stars),
        reviewsCount: firstNonEmpty(item.reviewsCount, item.reviews),
        category: firstNonEmpty(item.category, item.categoryName),
        sourceUrl: firstNonEmpty(item.url, item.sourceUrl, item.link),
        scrapedAt: formatDate(),
        actorVersion: ACTOR_VERSION,
    };
}
