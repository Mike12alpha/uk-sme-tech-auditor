/**
 * Google Maps business-listing scraper.
 *
 * Google's Maps DOM uses obfuscated, frequently-changing class names, so
 * this relies on the more stable `data-item-id` / `role` attributes Google
 * uses for accessibility. Soft fields (rating, category) are best-effort —
 * if Google changes markup, those come back null rather than failing the
 * whole record.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { newLeadId, formatDate, extractDomain, sleep } from '../utils.js';
import { ACTOR_VERSION } from '../constants.js';

chromium.use(StealthPlugin());

const FEED_SELECTOR = 'div[role="feed"]';
const MAX_SCROLL_ROUNDS = 40;
const MAX_STAGNANT_ROUNDS = 4;

async function autoScrollFeed(page, maxResults) {
    let previousCount = 0;
    let stagnantRounds = 0;
    for (let i = 0; i < MAX_SCROLL_ROUNDS; i++) {
        const count = await page.locator(`${FEED_SELECTOR} a[href*="/maps/place/"]`).count().catch(() => 0);
        if (count >= maxResults) break;
        if (count === previousCount) {
            stagnantRounds += 1;
            if (stagnantRounds >= MAX_STAGNANT_ROUNDS) break;
        } else {
            stagnantRounds = 0;
        }
        previousCount = count;
        await page.evaluate((sel) => {
            const feed = document.querySelector(sel);
            if (feed) feed.scrollTop = feed.scrollHeight;
        }, FEED_SELECTOR).catch(() => {});
        await sleep(1200 + Math.random() * 600);
    }
}

async function extractPlaceLinks(page, maxResults) {
    const links = await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        const anchors = feed
            ? feed.querySelectorAll('a[href*="/maps/place/"]')
            : document.querySelectorAll('a[href*="/maps/place/"]');
        const seen = new Set();
        const out = [];
        anchors.forEach((a) => {
            if (!seen.has(a.href)) {
                seen.add(a.href);
                out.push({ href: a.href, name: a.getAttribute('aria-label') || '' });
            }
        });
        return out;
    }, FEED_SELECTOR);
    return links.slice(0, maxResults);
}

async function extractPlaceDetail(page) {
    return page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const name = q('h1')?.textContent?.trim() || null;

        const websiteEl = q('a[data-item-id="authority"]');
        const website = websiteEl ? websiteEl.href : null;

        const phoneEl = q('button[data-item-id^="phone:tel:"]');
        const phone = phoneEl
            ? (phoneEl.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '').trim() || phoneEl.textContent?.trim())
            : null;

        const addressEl = q('button[data-item-id="address"]');
        const address = addressEl
            ? (addressEl.getAttribute('aria-label')?.replace(/^Address:\s*/i, '').trim() || addressEl.textContent?.trim())
            : null;

        let rating = null;
        const ratingText = document.body.innerText.match(/(\d\.\d)\s*(?:star|\()/i);
        if (ratingText) {
            const v = parseFloat(ratingText[1]);
            if (!Number.isNaN(v)) rating = v;
        }

        const reviewsMatch = document.body.innerText.match(/([\d,]+)\s+reviews?/i);
        const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null;

        const categoryEl = q('button[jsaction*="category"]');
        const category = categoryEl ? categoryEl.textContent.trim() : null;

        return { name, website, phone, address, rating, reviewsCount, category };
    });
}

export async function runGoogleMapsSource({ queries, location, maxResultsPerQuery, proxyConfiguration, countryCode, log: actorLog }) {
    const leads = [];
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

    const browser = await chromium.launch({
        headless: true,
        proxy: proxyUrl ? { server: proxyUrl } : undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    try {
        for (const query of queries) {
            const context = await browser.newContext({
                locale: 'en-GB',
                viewport: { width: 1366, height: 900 },
            });
            const page = await context.newPage();
            try {
                const searchTerm = location ? `${query} ${location}` : query;
                const url = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.waitForTimeout(2500);

                const hasFeed = (await page.locator(FEED_SELECTOR).count()) > 0;
                let placeLinks = [];

                if (hasFeed) {
                    await autoScrollFeed(page, maxResultsPerQuery);
                    placeLinks = await extractPlaceLinks(page, maxResultsPerQuery);
                } else if (/\/maps\/place\//.test(page.url())) {
                    placeLinks = [{ href: page.url(), name: null }];
                }

                actorLog.info(`Google Maps: found ${placeLinks.length} place(s) for "${searchTerm}"`);

                for (const link of placeLinks) {
                    try {
                        if (page.url() !== link.href) {
                            await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.waitForTimeout(1200);
                        }
                        const detail = await extractPlaceDetail(page);
                        const website = detail.website;
                        leads.push({
                            leadId: newLeadId(),
                            source: 'google_maps',
                            type: 'company',
                            companyName: detail.name || link.name || null,
                            personName: null,
                            jobTitle: null,
                            industry: null,
                            website,
                            domain: website ? extractDomain(website) : null,
                            email: null,
                            emailStatus: null,
                            phone: detail.phone || null,
                            address: detail.address || null,
                            city: location || null,
                            country: countryCode || null,
                            linkedinUrl: null,
                            socialLinks: {},
                            rating: detail.rating,
                            reviewsCount: detail.reviewsCount,
                            category: detail.category,
                            sourceUrl: link.href,
                            scrapedAt: formatDate(),
                            actorVersion: ACTOR_VERSION,
                        });
                    } catch (err) {
                        actorLog.warning(`Google Maps: failed to extract place detail (${link.href}): ${err.message}`);
                    }
                    await sleep(600 + Math.random() * 500);
                }
            } catch (err) {
                actorLog.error(`Google Maps: query "${query}" failed: ${err.message}`);
            } finally {
                await context.close().catch(() => {});
            }
        }
    } finally {
        await browser.close().catch(() => {});
    }

    return leads;
}
