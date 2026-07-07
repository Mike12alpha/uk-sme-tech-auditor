/**
 * Crawlee request router.
 * Handles directory pages (extracts company links) and company websites (audits + scores).
 */

import { createPlaywrightRouter } from 'crawlee';
import { Actor } from 'apify';
import { isDirectoryPage, extractDomain, normalizeUrl, extractCompanyName, formatDate, isAllowedByRobotsTxt } from './utils.js';
import { audit } from './techAuditor.js';
import { score } from './aiScorer.js';
import { ACTOR_VERSION } from './constants.js';

const router = createPlaywrightRouter();

/**
 * Extract likely company website links from a directory/listing page.
 * @param {import('playwright').Page} page
 * @param {string} currentHostname
 * @returns {Promise<string[]>}
 */
async function extractCompanyLinks(page, currentHostname) {
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
            .map((a) => a.href)
            .filter((href) => href.startsWith('http'));
    });

    const seen = new Set();
    const companyLinks = [];

    for (const href of links) {
        const normalized = normalizeUrl(href);
        if (!normalized) continue;

        const hostname = new URL(normalized).hostname.toLowerCase();

        // Skip directory's own internal links and common non-company hosts
        if (hostname === currentHostname) continue;
        if (hostname.includes('facebook.com')
            || hostname.includes('twitter.com')
            || hostname.includes('x.com')
            || hostname.includes('linkedin.com')
            || hostname.includes('instagram.com')
            || hostname.includes('youtube.com')
            || hostname.includes('javascript:')
            || normalized.includes('mailto:')
            || normalized.includes('tel:')) continue;

        // Use root domain to avoid duplicates
        const domain = extractDomain(normalized);
        if (seen.has(domain)) continue;
        seen.add(domain);

        // Only keep links that look like external business sites
        const looksLikeCompany = !isDirectoryPage(normalized);
        if (looksLikeCompany) companyLinks.push(normalized);
    }

    return companyLinks.slice(0, 50); // cap per directory page
}

/**
 * Audit a company website and push the lead record.
 */
async function auditCompany({ request, page, log, industry, companySize }) {
    const url = request.loadedUrl || request.url;
    log.info(`Auditing company site: ${url}`);

    try {
        const allowed = await isAllowedByRobotsTxt(url);
        if (!allowed) {
            log.warning(`Skipping ${url} — robots.txt disallows crawling.`);
            return;
        }
        const companyName = await extractCompanyName(page, url);
        const techData = await audit(url, page);
        const aiResult = await score(techData, url, industry || 'automotive', companySize || 'SME');

        const lead = {
            url,
            companyName,
            industry: industry || 'automotive',
            companySize: companySize || 'SME',
            techStack: techData.techStack,
            lighthousePerformance: techData.lighthousePerformance,
            lighthouseSeo: techData.lighthouseSeo,
            lighthouseBestPractices: techData.lighthouseBestPractices,
            hasSsl: techData.hasSsl,
            hasBookingSystem: techData.hasBookingSystem,
            hasEcommerce: techData.hasEcommerce,
            hasContactForm: techData.hasContactForm,
            pageLoadTime: techData.pageLoadTime,
            outsourcingScore: aiResult.score,
            painPoints: aiResult.painPoints,
            reasoning: aiResult.reasoning,
            glosixPitchAngle: aiResult.glosixPitchAngle,
            recommendedApproach: aiResult.recommendedApproach,
            decisionMaker: null,
            enrichmentStatus: 'pending',
            scrapedAt: formatDate(),
            actorVersion: ACTOR_VERSION,
        };

        await Actor.pushData(lead);
        log.info(`Scored ${url}: ${lead.outsourcingScore}`);
    } catch (err) {
        log.error(`Failed to audit ${url}: ${err.message}`);
        // Push a minimal failed record so the dataset still has visibility
        await Actor.pushData({
            url,
            companyName: extractDomain(url),
            industry: industry || 'automotive',
            companySize: companySize || 'SME',
            outsourcingScore: 0,
            painPoints: ['Audit failed'],
            reasoning: err.message,
            glosixPitchAngle: '',
            recommendedApproach: '',
            decisionMaker: null,
            enrichmentStatus: 'skipped',
            scrapedAt: formatDate(),
            actorVersion: ACTOR_VERSION,
        });
    }
}

/**
 * Default handler: directory pages extract company links; company sites are audited directly.
 */
router.addDefaultHandler(async ({ request, page, log, crawler, industry, companySize }) => {
    const url = request.loadedUrl || request.url;

    if (isDirectoryPage(url)) {
        log.info(`Processing directory page: ${url}`);
        try {
            const currentHostname = new URL(url).hostname.toLowerCase();
            const companyLinks = await extractCompanyLinks(page, currentHostname);
            log.info(`Found ${companyLinks.length} company links on ${url}`);

            const requests = companyLinks.map((link) => ({
                url: link,
                label: 'COMPANY',
                userData: { sourceDirectory: url },
            }));

            await crawler.addRequests(requests);
        } catch (err) {
            log.error(`Failed to process directory ${url}: ${err.message}`);
        }
    } else {
        await auditCompany({ request, page, log, industry, companySize });
    }
});

/**
 * Company website handler (for links discovered from directories).
 */
router.addHandler('COMPANY', async (ctx) => {
    await auditCompany(ctx);
});

export default router;
