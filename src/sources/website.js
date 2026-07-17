/**
 * Website enrichment: visits each lead's website (and, if no email is found,
 * a linked contact page) to pull emails, phone numbers, and social links.
 * If nothing is found and we have a person's name + domain, falls back to
 * a pattern-guessed email, only kept if the domain actually has mail
 * servers (MX record) — a cheap sanity check, not a real verification.
 *
 * Requests go through Crawlee's request queue, which persists `userData` as
 * JSON — so a lead object stuffed into `userData` and mutated inside the
 * handler is a disconnected clone, not the original object, and those edits
 * are silently lost. Instead we only pass the serializable `leadId` through
 * `userData` and look the real lead object up in `targetsByLeadId`, a plain
 * closure variable that Crawlee never touches.
 */

import { CheerioCrawler } from 'crawlee';
import {
    extractEmails, extractMailtoEmails, extractPhones, extractSocialLinks,
    generateEmailPatterns, domainHasMx, isFreeEmailProvider,
} from '../utils.js';

export async function enrichWebsites(leads, { proxyConfiguration, log: actorLog }) {
    const targets = leads.filter((l) => l.website && !l.email);
    if (!targets.length) return leads;

    const targetsByLeadId = new Map(targets.map((lead) => [lead.leadId, lead]));

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 5,
        // Enrichment is best-effort over arbitrary third-party sites; many
        // block the datacenter proxy (403) or the proxy itself returns
        // 502/504. Without tight caps, Crawlee retries + rotates sessions on
        // each such URL up to ~10 times, and a batch of 45 sites can burn
        // minutes and blow the actor's run timeout. Fail these fast.
        maxRequestRetries: 1,
        maxSessionRotations: 1,
        requestHandlerTimeoutSecs: 20,
        navigationTimeoutSecs: 15,
        maxRequestsPerCrawl: targets.length * 2,
        requestHandler: async ({ $, request, crawler: crawlerInstance }) => {
            const lead = targetsByLeadId.get(request.userData.leadId);
            if (!lead) return;

            const text = $('body').text();
            const html = $.html();

            if (!lead.email) {
                const emails = extractMailtoEmails(html).concat(extractEmails(text));
                const realEmail = emails.find((e) => !isFreeEmailProvider(e)) || emails[0];
                if (realEmail) {
                    lead.email = realEmail;
                    lead.emailStatus = 'found';
                }
            }

            if (!lead.phone) {
                const phones = extractPhones(text);
                if (phones.length) lead.phone = phones[0];
            }

            const social = extractSocialLinks(html);
            for (const [key, value] of Object.entries(social)) {
                if (value && !lead.socialLinks[key]) lead.socialLinks[key] = value;
            }
            if (!lead.linkedinUrl && social.linkedin) lead.linkedinUrl = social.linkedin;

            if (!lead.email && !request.userData.visitedContact) {
                const contactHref = $('a[href]').toArray()
                    .map((el) => $(el).attr('href'))
                    .find((href) => href && /contact/i.test(href));
                if (contactHref) {
                    try {
                        const contactUrl = new URL(contactHref, request.loadedUrl || request.url).href;
                        await crawlerInstance.addRequests([{
                            url: contactUrl,
                            userData: { leadId: lead.leadId, visitedContact: true },
                            uniqueKey: `${lead.leadId}-contact`,
                        }]);
                    } catch {
                        // Malformed contact link — skip.
                    }
                }
            }
        },
        failedRequestHandler: async ({ request }) => {
            actorLog.debug(`Website enrichment failed: ${request.url}`);
        },
    });

    await crawler.run(targets.map((lead) => ({
        url: lead.website,
        userData: { leadId: lead.leadId },
        uniqueKey: lead.leadId,
    })));

    for (const lead of targets) {
        if (!lead.email && lead.personName && lead.domain) {
            const [firstName, ...rest] = lead.personName.split(' ');
            const patterns = generateEmailPatterns(firstName, rest.join(' '), lead.domain);
            if (patterns.length) {
                const hasMx = await domainHasMx(lead.domain).catch(() => false);
                if (hasMx) {
                    lead.email = patterns[0];
                    lead.emailStatus = 'guessed';
                }
            }
        }
    }

    return leads;
}
