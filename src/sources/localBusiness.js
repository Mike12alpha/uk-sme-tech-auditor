/**
 * Local business source, powered by OpenStreetMap's Nominatim search API.
 *
 *   1. Geocode the free-text `location` to a bounding box.
 *   2. For each search term, run a viewbox-bounded Nominatim search and turn
 *      the matching business POIs into leads (name, address, phone, website,
 *      category, coordinates).
 *
 * This is our own crawler — plain HTTP to an open, scraping-friendly public
 * API. No browser, no third-party Apify Actor, works on any Apify plan, no
 * per-result cost.
 *
 * Why Nominatim and not Overpass: an earlier version used the Overpass API
 * for category lookups, but from Apify's datacenter network every Overpass
 * mirror consistently timed out or was throttled (four mirrors × 25s each
 * blew the run timeout). Nominatim is reachable and fast from Apify, and a
 * viewbox-bounded search on the category term (e.g. "dentist") returns
 * comparable coverage (~40 results) in a single lightweight request.
 *
 * Coverage note: search by the OSM-style category term ("dentist", "car
 * rental", "restaurant"), not a name-like phrase ("dental clinic") — the
 * former matches the business category and returns far more results. The
 * ICP-derivation prompt is tuned to produce these category terms.
 */

import { newLeadId, formatDate, extractDomain, normalizeUrl, sleep } from '../utils.js';
import { ACTOR_VERSION } from '../constants.js';
import { getCached, setCached } from '../cache.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim usage policy: identify the client, and stay at/under 1 req/sec.
const USER_AGENT = 'universal-lead-generator/2.1 (Apify Actor; B2B lead generation)';
const REQUEST_TIMEOUT_MS = 20000;
const NOMINATIM_PER_QUERY_LIMIT = 50;   // Nominatim's practical max per request.
const RESULTS_PER_TILE = 45;            // conservative estimate used to size the grid.
const MAX_GRID_DIM = 10;                // hard cap: 10×10 = 100 tiles per query.
// OSM top-level categories that represent contactable businesses/orgs.
const BUSINESS_CATEGORIES = new Set(['amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure', 'club']);
// ...and categories that are clearly not a business, filtered out.
const NON_BUSINESS_CATEGORIES = new Set(['highway', 'boundary', 'place', 'natural', 'waterway', 'railway', 'landuse', 'route', 'barrier', 'man_made', 'building', 'admin']);

async function nominatimGet(params) {
    const url = `${NOMINATIM_URL}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
        if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function geocode(location) {
    const data = await nominatimGet(new URLSearchParams({ q: location, format: 'json', limit: '1' }));
    if (!Array.isArray(data) || !data.length) return null;
    // Nominatim boundingbox is [south, north, west, east] (strings).
    const [south, north, west, east] = data[0].boundingbox.map(Number);
    if ([south, north, west, east].some(Number.isNaN)) return null;
    return { south, west, north, east };
}

function isBusinessResult(p) {
    if (!p.name) return false;
    const category = p.category || p.class;
    if (category && NON_BUSINESS_CATEGORIES.has(category)) return false;
    // Accept known business categories; if the category is unknown/absent but
    // the place has a name and a street address, keep it (it's a real POI).
    if (category && BUSINESS_CATEGORIES.has(category)) return true;
    return !!(p.address && (p.address.road || p.address.house_number));
}

function composeAddress(p) {
    const a = p.address || {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(' ');
    const parts = [line1, a.city || a.town || a.village || a.suburb, a.postcode].filter(Boolean);
    if (parts.length) return parts.join(', ');
    // Fall back to trimming the leading name off the long display_name.
    if (p.display_name) return p.display_name.split(',').slice(1, 4).join(',').trim() || p.display_name;
    return null;
}

function resultToLead(p, location, countryCode) {
    const tags = p.extratags || {};
    const rawWebsite = tags.website || tags['contact:website'] || tags.url || null;
    const website = rawWebsite
        ? normalizeUrl(rawWebsite.startsWith('http') ? rawWebsite : `https://${rawWebsite}`)
        : null;
    const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null;
    const email = tags.email || tags['contact:email'] || null;
    const addr = p.address || {};

    return {
        leadId: newLeadId(),
        source: 'local_business',
        type: 'company',
        companyName: p.name || p.namedetails?.name || null,
        personName: null,
        jobTitle: null,
        industry: null,
        website,
        domain: website ? extractDomain(website) : null,
        email: email ? email.toLowerCase() : null,
        emailStatus: email ? 'found' : null,
        phone,
        address: composeAddress(p),
        postcode: addr.postcode || null,
        city: addr.city || addr.town || addr.village || addr.suburb || location || null,
        country: addr.country_code ? addr.country_code.toUpperCase() : (countryCode || null),
        latitude: p.lat ? Number(p.lat) : null,
        longitude: p.lon ? Number(p.lon) : null,
        linkedinUrl: null,
        socialLinks: {},
        rating: null,
        reviewsCount: null,
        category: (p.category || p.class) ? `${p.category || p.class}: ${p.type}` : null,
        sourceUrl: p.osm_type && p.osm_id ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : null,
        scrapedAt: formatDate(),
        actorVersion: ACTOR_VERSION,
    };
}

/** Build the viewbox string (left,top,right,bottom = west,north,east,south) for a sub-tile. */
function tileViewbox(bbox, gx, gy, dim) {
    const w = bbox.west + ((bbox.east - bbox.west) * gx) / dim;
    const e = bbox.west + ((bbox.east - bbox.west) * (gx + 1)) / dim;
    const s = bbox.south + ((bbox.north - bbox.south) * gy) / dim;
    const n = bbox.south + ((bbox.north - bbox.south) * (gy + 1)) / dim;
    return `${w},${n},${e},${s}`;
}

async function nominatimSearchTile(query, viewbox) {
    return nominatimGet(new URLSearchParams({
        q: query,
        viewbox,
        bounded: '1',
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        limit: String(NOMINATIM_PER_QUERY_LIMIT),
    }));
}

/**
 * Scrape up to `target` businesses for one search term. If the target is
 * larger than a single Nominatim request can return, the geocoded area is
 * split into an N×N grid and each tile searched — searching sub-areas
 * surfaces different businesses, multiplying coverage (e.g. "dentist" in
 * London: ~50 for the whole box, ~450 across a 3×3 grid).
 */
async function scrapeQuery(query, bbox, target, location, countryCode, actorLog) {
    const dim = Math.min(MAX_GRID_DIM, Math.max(1, Math.ceil(Math.sqrt(target / RESULTS_PER_TILE))));
    const leads = [];
    const seen = new Set();

    // Snake through the grid so an early `target` stop still covers spread-out area.
    const tiles = [];
    if (dim === 1) {
        tiles.push(`${bbox.west},${bbox.north},${bbox.east},${bbox.south}`);
    } else {
        for (let gy = 0; gy < dim; gy++) {
            for (let gx = 0; gx < dim; gx++) tiles.push(tileViewbox(bbox, gx, gy, dim));
        }
    }

    for (const viewbox of tiles) {
        if (leads.length >= target) break;
        await sleep(1100); // Nominatim ≤1 req/sec.
        let results;
        try {
            results = await nominatimSearchTile(query, viewbox);
        } catch (err) {
            actorLog.warning(`Local business: a tile search for "${query}" failed (${err.message}); continuing.`);
            continue;
        }
        for (const p of Array.isArray(results) ? results : []) {
            if (leads.length >= target) break;
            if (!isBusinessResult(p)) continue;
            const lead = resultToLead(p, location, countryCode);
            const key = lead.sourceUrl || `${lead.companyName}|${lead.address || ''}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            leads.push(lead);
        }
    }
    actorLog.info(`Local business: "${query}" → ${leads.length} business(es) (grid ${dim}×${dim}).`);
    return leads;
}

export async function runLocalBusinessSource({ queries, location, maxResultsPerQuery, countryCode, log: actorLog }) {
    if (!location) {
        actorLog.warning('Local business source needs a `location` to bound the search — skipping.');
        return [];
    }
    if (!queries?.length) return [];

    const target = Math.max(1, maxResultsPerQuery || 50);

    let bbox = null; // geocoded lazily and reused across queries (only if a query misses cache).

    const all = [];
    const seenGlobal = new Set();
    for (const query of queries) {
        const cacheId = `local|${query.toLowerCase().trim()}|${location.toLowerCase().trim()}|${target}`;
        let queryLeads = await getCached(cacheId);
        if (queryLeads) {
            actorLog.info(`Local business: "${query}" → ${queryLeads.length} business(es) from cache.`);
        } else {
            if (!bbox) {
                try {
                    bbox = await geocode(location);
                } catch (err) {
                    actorLog.error(`Local business: geocoding "${location}" failed: ${err.message}`);
                    return all;
                }
                if (!bbox) {
                    actorLog.error(`Local business: could not geocode "${location}".`);
                    return all;
                }
            }
            queryLeads = await scrapeQuery(query, bbox, target, location, countryCode, actorLog);
            await setCached(cacheId, queryLeads);
        }

        for (const lead of queryLeads) {
            const key = lead.sourceUrl || `${lead.companyName}|${lead.address || ''}`.toLowerCase();
            if (seenGlobal.has(key)) continue;
            seenGlobal.add(key);
            all.push(lead);
        }
    }

    return all;
}
