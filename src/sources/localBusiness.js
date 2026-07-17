/**
 * Local business source, powered entirely by OpenStreetMap:
 *   1. Nominatim geocodes the free-text `location` into a bounding box.
 *   2. Overpass returns businesses inside that box, matched either by a
 *      keyword→OSM-tag mapping (e.g. "dental clinics" → amenity=dentist) or,
 *      for unmapped keywords, by a name search across business tag families.
 *
 * This is our own crawler — plain HTTP to open, scraping-friendly public
 * APIs. No browser, no proxy, no third-party Apify Actor, works on any Apify
 * plan, no per-result cost. It deliberately replaces direct Google Maps
 * scraping, which needs residential proxies (Google tarpits datacenter IPs)
 * not available on lower tiers. Tradeoff: fewer businesses than Google Maps
 * and no ratings/reviews, but reliable name/address/phone/website/category.
 */

import { newLeadId, formatDate, extractDomain, normalizeUrl, sleep } from '../utils.js';
import { ACTOR_VERSION, KEYWORD_OSM_TAGS, OSM_BUSINESS_TAG_FAMILIES } from '../constants.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Multiple Overpass mirrors. The main overpass-api.de instance is heavily
// loaded and frequently returns 504/429; the others are alternates. We try
// each mirror once with a short per-request timeout and move straight on to
// the next if it errors or is slow — cycling mirrors IS the retry strategy,
// which avoids hammering (and waiting on) one overloaded server.
const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
];
// Healthy mirrors answer these small city+tag queries in a few seconds; if a
// mirror hasn't responded in this long it's overloaded — abandon it and move on.
const OVERPASS_REQUEST_TIMEOUT_MS = 25000;
// Nominatim/Overpass usage policy: identify the client and go easy on volume.
const USER_AGENT = 'universal-lead-generator/2.0 (Apify Actor; B2B lead generation)';

async function geocode(location) {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    // Nominatim boundingbox is [south, north, west, east] (strings).
    const [south, north, west, east] = data[0].boundingbox.map(Number);
    if ([south, north, west, east].some(Number.isNaN)) return null;
    return { south, west, north, east };
}

function escapeForOverpass(value) {
    return value.replace(/["\\]/g, ' ').trim();
}

function buildOverpassQuery(keyword, bbox, limit) {
    const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    const kw = keyword.toLowerCase();

    const mappedTags = [];
    for (const [needle, tagList] of Object.entries(KEYWORD_OSM_TAGS)) {
        if (kw.includes(needle)) mappedTags.push(...tagList);
    }

    let selectors;
    if (mappedTags.length) {
        selectors = [...new Set(mappedTags)].flatMap((tag) => {
            const [k, v] = tag.split('=');
            return [
                `  node["${k}"="${v}"](${b});`,
                `  way["${k}"="${v}"](${b});`,
            ];
        }).join('\n');
    } else {
        const safe = escapeForOverpass(keyword);
        selectors = OSM_BUSINESS_TAG_FAMILIES.flatMap((family) => [
            `  node["name"~"${safe}",i]["${family}"](${b});`,
            `  way["name"~"${safe}",i]["${family}"](${b});`,
        ]).join('\n');
    }

    return `[out:json][timeout:60];\n(\n${selectors}\n);\nout center tags ${limit};`;
}

async function fetchOverpassOnce(endpoint, query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.elements || [];
    } finally {
        clearTimeout(timer);
    }
}

async function runOverpass(query, log) {
    for (let i = 0; i < OVERPASS_URLS.length; i++) {
        const endpoint = OVERPASS_URLS[i];
        const isLast = i === OVERPASS_URLS.length - 1;
        try {
            return await fetchOverpassOnce(endpoint, query);
        } catch (err) {
            const reason = err.name === 'AbortError' ? `no response in ${OVERPASS_REQUEST_TIMEOUT_MS / 1000}s` : err.message;
            log.warning(`Overpass ${endpoint} failed (${reason})${isLast ? '.' : '; trying next mirror.'}`);
        }
    }
    return null;
}

function composeAddress(tags) {
    const line1 = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const parts = [
        line1,
        tags['addr:city'] || tags['addr:town'] || tags['addr:suburb'],
        tags['addr:postcode'],
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
}

function pickCategory(tags) {
    for (const family of OSM_BUSINESS_TAG_FAMILIES) {
        if (tags[family]) return `${family}: ${tags[family]}`;
    }
    return null;
}

function elementToLead(element, location, countryCode) {
    const tags = element.tags || {};
    if (!tags.name) return null;

    const rawWebsite = tags.website || tags['contact:website'] || tags.url || null;
    const website = rawWebsite ? normalizeUrl(rawWebsite.startsWith('http') ? rawWebsite : `https://${rawWebsite}`) : null;
    const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null;
    const email = tags.email || tags['contact:email'] || null;

    return {
        leadId: newLeadId(),
        source: 'local_business',
        type: 'company',
        companyName: tags.name,
        personName: null,
        jobTitle: null,
        industry: null,
        website,
        domain: website ? extractDomain(website) : null,
        email: email ? email.toLowerCase() : null,
        emailStatus: email ? 'found' : null,
        phone,
        address: composeAddress(tags),
        city: tags['addr:city'] || tags['addr:town'] || location || null,
        country: tags['addr:country'] || countryCode || null,
        linkedinUrl: null,
        socialLinks: {},
        rating: null,
        reviewsCount: null,
        category: pickCategory(tags),
        sourceUrl: element.type && element.id ? `https://www.openstreetmap.org/${element.type}/${element.id}` : null,
        scrapedAt: formatDate(),
        actorVersion: ACTOR_VERSION,
    };
}

export async function runLocalBusinessSource({ queries, location, maxResultsPerQuery, countryCode, log: actorLog }) {
    if (!location) {
        actorLog.warning('Local business source needs a `location` to bound the search — skipping.');
        return [];
    }
    if (!queries?.length) return [];

    let bbox;
    try {
        bbox = await geocode(location);
    } catch (err) {
        actorLog.error(`Local business: geocoding "${location}" failed: ${err.message}`);
        return [];
    }
    if (!bbox) {
        actorLog.error(`Local business: could not geocode "${location}".`);
        return [];
    }

    const leads = [];
    const seen = new Set();

    for (const query of queries) {
        const overpassQuery = buildOverpassQuery(query, bbox, maxResultsPerQuery);
        // Nominatim asks for <= 1 req/sec; Overpass appreciates the same restraint.
        await sleep(1100);
        const elements = await runOverpass(overpassQuery, actorLog);
        if (elements === null) {
            actorLog.error(`Local business: all Overpass endpoints failed for "${query}".`);
            continue;
        }

        let added = 0;
        for (const element of elements) {
            const lead = elementToLead(element, location, countryCode);
            if (!lead) continue;
            const key = `${lead.companyName}|${lead.address || ''}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            leads.push(lead);
            added += 1;
        }
        actorLog.info(`Local business: "${query}" → ${added} business(es) from OpenStreetMap.`);
    }

    return leads;
}
