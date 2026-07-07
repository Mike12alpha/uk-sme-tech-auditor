/**
 * Tech stack auditing module.
 * Combines Wappalyzer, Lighthouse, and Playwright heuristics.
 */

import Wappalyzer from 'wappalyzer';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { retryAsync } from './utils.js';
import { KNOWN_CMS, KNOWN_FRAMEWORKS, KNOWN_ANALYTICS, KNOWN_ECOMMERCE } from './constants.js';

/**
 * Run Wappalyzer against a URL.
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function runWappalyzer(url) {
    let wappalyzer;
    try {
        wappalyzer = new Wappalyzer({
            debug: false,
            recursive: false,
            maxDepth: 0,
            maxUrls: 1,
            maxWait: 10000,
        });

        await wappalyzer.init();
        const headers = {};
        const storage = {};
        const site = await wappalyzer.open(url, headers, storage);
        const results = await site.analyze();
        await wappalyzer.destroy();
        return results;
    } catch (err) {
        if (wappalyzer) await wappalyzer.destroy().catch(() => {});
        throw err;
    }
}

/**
 * Basic meta-tag / DOM-based tech detection fallback.
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function fallbackTechDetection(page) {
    const detected = new Set();
    try {
        const meta = await page.evaluate(() => {
            const generator = document.querySelector('meta[name="generator"]')?.content || '';
            const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
            const html = document.documentElement.innerHTML.substring(0, 20000).toLowerCase();
            return { generator, scripts, html };
        });

        const text = `${meta.generator} ${meta.scripts.join(' ')} ${meta.html}`;

        if (text.includes('wordpress')) detected.add('WordPress');
        if (text.includes('shopify')) detected.add('Shopify');
        if (text.includes('wix')) detected.add('Wix');
        if (text.includes('squarespace')) detected.add('Squarespace');
        if (text.includes('drupal')) detected.add('Drupal');
        if (text.includes('joomla')) detected.add('Joomla');
        if (text.includes('magento')) detected.add('Magento');
        if (text.includes('woocommerce')) detected.add('WooCommerce');
        if (text.includes('react')) detected.add('React');
        if (text.includes('vue')) detected.add('Vue.js');
        if (text.includes('angular')) detected.add('Angular');
        if (text.includes('jquery')) detected.add('jQuery');
        if (text.includes('googletagmanager') || text.includes('gtm-')) detected.add('Google Tag Manager');
        if (text.includes('google-analytics') || text.includes('ga(')) detected.add('Google Analytics');
        if (text.includes('hotjar')) detected.add('Hotjar');
    } catch {
        // ignore
    }
    return Array.from(detected);
}

/**
 * Run Lighthouse audit.
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function runLighthouse(url) {
    let chrome;
    try {
        chrome = await chromeLauncher.launch({
            chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
        });

        const options = {
            logLevel: 'error',
            output: 'json',
            onlyCategories: ['performance', 'seo', 'best-practices'],
            port: chrome.port,
        };

        const runnerResult = await lighthouse(url, options);
        await chrome.kill();
        chrome = null;

        const lhr = runnerResult?.lhr;
        return {
            performance: Math.round(lhr?.categories?.performance?.score * 100 ?? 0),
            seo: Math.round(lhr?.categories?.seo?.score * 100 ?? 0),
            bestPractices: Math.round(lhr?.categories?.['best-practices']?.score * 100 ?? 0),
            audits: lhr?.audits || {},
        };
    } catch (err) {
        if (chrome) {
            try { await chrome.kill(); } catch { /* ignore */ }
        }
        throw err;
    }
}

/**
 * Detect page features using Playwright.
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>}
 */
async function detectPageFeatures(page) {
    return page.evaluate(() => {
        const html = document.body?.innerText?.toLowerCase() || '';
        const allText = document.documentElement.innerText.toLowerCase();

        const hasSsl = window.location.protocol === 'https:';

        // Booking hints
        const bookingKeywords = ['book now', 'book online', 'appointment', 'reserve', 'schedule', 'booking'];
        const hasBookingSystem = bookingKeywords.some((kw) => allText.includes(kw))
            || !!document.querySelector('iframe[src*="booking"], iframe[src*="appointlet"], iframe[src*="calendly"]');

        // E-commerce hints
        const ecommerceKeywords = ['cart', 'basket', 'checkout', 'shop now', 'add to cart', 'buy now'];
        const hasEcommerce = ecommerceKeywords.some((kw) => allText.includes(kw))
            || !!document.querySelector('[class*="cart"], [class*="checkout"], [id*="cart"], [id*="checkout"]');

        // Contact form hints
        const hasContactForm = !!document.querySelector('form')
            && ['contact', 'email', 'phone', 'message'].some((kw) => allText.includes(kw));

        // Page load timing
        const timing = performance.timing;
        const pageLoadTime = timing && timing.loadEventEnd > 0
            ? Math.round(timing.loadEventEnd - timing.navigationStart)
            : null;

        // Mobile responsiveness hint
        const viewportMeta = document.querySelector('meta[name="viewport"]')?.content || '';
        const mobileResponsive = viewportMeta.includes('width=device-width');

        return {
            hasSsl,
            hasBookingSystem,
            hasEcommerce,
            hasContactForm,
            pageLoadTime,
            mobileResponsive,
        };
    });
}

/**
 * Audit a single website.
 * @param {string} url
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>}
 */
export async function audit(url, page) {
    const result = {
        techStack: [],
        cms: null,
        frameworks: [],
        analytics: [],
        ecommerce: [],
        server: [],
        lighthousePerformance: null,
        lighthouseSeo: null,
        lighthouseBestPractices: null,
        hasSsl: false,
        hasBookingSystem: false,
        hasEcommerce: false,
        hasContactForm: false,
        pageLoadTime: null,
        mobileResponsive: false,
    };

    // 1. Wappalyzer detection
    try {
        const wapp = await retryAsync(() => runWappalyzer(url), 1);
        const techs = wapp?.technologies || [];
        result.techStack = techs.map((t) => t.name);

        result.cms = techs.find((t) => KNOWN_CMS.includes(t.name))?.name || null;
        result.frameworks = techs.filter((t) => KNOWN_FRAMEWORKS.includes(t.name)).map((t) => t.name);
        result.analytics = techs.filter((t) => KNOWN_ANALYTICS.includes(t.name)).map((t) => t.name);
        result.ecommerce = techs.filter((t) => KNOWN_ECOMMERCE.includes(t.name)).map((t) => t.name);
        result.server = techs.filter((t) => t.categories?.some((c) => c.slug === 'web-servers')).map((t) => t.name);
    } catch (err) {
        // Fallback to meta tag detection
        const fallback = await fallbackTechDetection(page);
        result.techStack = fallback;
        result.cms = fallback.find((t) => KNOWN_CMS.includes(t)) || null;
        result.frameworks = fallback.filter((t) => KNOWN_FRAMEWORKS.includes(t));
        result.analytics = fallback.filter((t) => KNOWN_ANALYTICS.includes(t));
        result.ecommerce = fallback.filter((t) => KNOWN_ECOMMERCE.includes(t));
    }

    // 2. Lighthouse audit
    try {
        const lh = await retryAsync(() => runLighthouse(url), 1);
        result.lighthousePerformance = lh.performance;
        result.lighthouseSeo = lh.seo;
        result.lighthouseBestPractices = lh.bestPractices;
    } catch {
        // Lighthouse failed — Playwright timings will still be present below
    }

    // 3. Playwright feature detection
    try {
        const features = await detectPageFeatures(page);
        Object.assign(result, features);
    } catch {
        // ignore
    }

    // Ensure derived booleans align
    if (result.ecommerce.length > 0) result.hasEcommerce = true;

    return result;
}
