/**
 * Cross-run cache backed by a named Apify Key-Value Store ("LEAD-CACHE").
 *
 * Because it's a *named* store, it persists across runs of this Actor on the
 * same account — so once a (source + query + area) has been scraped, later
 * runs return the stored leads instantly instead of hitting the source APIs
 * again. This both speeds up repeat runs and keeps us well within the public
 * OSM/Nominatim usage limits.
 *
 * KV store keys may only contain [a-zA-Z0-9!-_.'()], so the human-readable
 * cache identifier is hashed to a safe hex key.
 */

import { createHash } from 'node:crypto';
import { Actor, log } from 'apify';

let store = null;
let maxAgeMs = 7 * 24 * 60 * 60 * 1000;

export async function initCache({ enabled, maxAgeDays } = {}) {
    if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    if (!enabled) {
        store = null;
        return;
    }
    try {
        store = await Actor.openKeyValueStore('LEAD-CACHE');
        log.info(`Cache enabled (LEAD-CACHE, max age ${(maxAgeMs / 86400000).toFixed(1)} days).`);
    } catch (err) {
        log.warning(`Could not open cache store (${err.message}); continuing without cache.`);
        store = null;
    }
}

export function isCacheEnabled() {
    return !!store;
}

function keyFor(identifier) {
    return `c_${createHash('sha256').update(identifier).digest('hex')}`;
}

/** Return cached leads for `identifier` if present and still fresh, else null. */
export async function getCached(identifier) {
    if (!store) return null;
    try {
        const rec = await store.getValue(keyFor(identifier));
        if (!rec || typeof rec.ts !== 'number' || !Array.isArray(rec.leads)) return null;
        if (Date.now() - rec.ts > maxAgeMs) return null;
        return rec.leads;
    } catch {
        return null;
    }
}

export async function setCached(identifier, leads) {
    if (!store) return;
    try {
        await store.setValue(keyFor(identifier), { ts: Date.now(), identifier, leads });
    } catch (err) {
        log.debug(`Cache write failed for "${identifier}": ${err.message}`);
    }
}
