/**
 * Configuration, defaults, and prompts for the Universal Lead Generator.
 */

export const ACTOR_VERSION = '2.0.0';

export const SOURCES = {
    LOCAL_BUSINESS: 'localBusiness',
    LINKEDIN: 'linkedin',
    DIRECTORY: 'directory',
    WEB_SEARCH: 'webSearch',
};

// Legacy source ids accepted from older inputs, mapped to their current id.
export const SOURCE_ALIASES = {
    googleMaps: 'localBusiness',
};

export const CRAWLER_DEFAULTS = {
    maxResultsPerSource: 50,
    minScoreThreshold: 0,
    maxConcurrency: 3,
    requestTimeoutSecs: 90,
    navigationTimeoutSecs: 60,
};

export const PROXY_CONFIG = {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
};

// Fallback persona titles used for LinkedIn discovery when the caller
// doesn't supply their own `personaTitles`.
export const DEFAULT_PERSONA_TITLES = [
    'Owner',
    'Founder',
    'CEO',
    'Managing Director',
    'Director',
];

// Known business-directory / listing-site domains. Pages on these hosts are
// treated as link hubs (extract outbound company links) rather than as
// leads themselves.
export const DIRECTORY_DOMAINS = [
    'yell.com',
    'yelp.com',
    'thomsonlocal.com',
    'bark.com',
    '192.com',
    'applegate.co.uk',
    'cylex-uk.co.uk',
    'hotfrog.co.uk',
    'hotfrog.com',
    'foursquare.com',
    'tripadvisor.com',
    'tripadvisor.co.uk',
    'checkatrade.com',
    'trustatrader.com',
    'manta.com',
    'bbb.org',
    'crunchbase.com',
    'clutch.co',
    'goodfirms.co',
];

export const SCORE_LABELS = {
    hot: 'Hot lead',
    warm: 'Warm lead',
    cold: 'Cold lead',
    ignore: 'Ignore',
};

export function calculateLeadQuality(score) {
    if (score >= 80) return SCORE_LABELS.hot;
    if (score >= 60) return SCORE_LABELS.warm;
    if (score >= 40) return SCORE_LABELS.cold;
    return SCORE_LABELS.ignore;
}

export const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

// Common personal-email providers — used to decide whether a scraped
// address is a real decision-maker contact or a generic mailbox.
export const FREE_EMAIL_PROVIDERS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'live.com', 'protonmail.com', 'mail.com',
];

export const LLM_SCORER_SYSTEM_PROMPT = `You are a B2B sales research analyst. You will be given:
1. An Ideal Customer Profile (ICP) description written by the user (any industry, any persona, any region).
2. A single scraped lead record (a company and/or a person).

Score how well this lead matches the ICP on a 0-100 scale and explain briefly why.

SCORING GUIDANCE:
- 80-100: Strong match — company/persona/industry/location line up closely with the ICP.
- 60-79: Good partial match — most criteria match, one or two are unclear or missing.
- 40-59: Weak match — only loosely related, or too much missing data to be confident.
- 0-39: Poor match or clearly outside the ICP.

Be honest about missing data — do not invent facts. If a field is blank, treat it as unknown rather than assuming it's bad.

Respond with ONLY a JSON object, no other text:
{
  "score": number,
  "matchedPersona": boolean,
  "reasoning": "one or two sentence explanation",
  "suggestedApproach": "one short, concrete outreach suggestion"
}`;

export const ICP_PARSER_SYSTEM_PROMPT = `You turn a free-text Ideal Customer Profile (ICP) into structured search parameters for a lead-generation tool. From the ICP, extract:

- "searchQueries": 1-3 short OpenStreetMap-style category terms for the business type — the singular word you'd use to tag/find the place, NOT a marketing phrase. Good: ["dentist"], ["car rental"], ["restaurant"], ["accountant"], ["gym"]. Bad: ["dental clinics"], ["car rental company"], ["independent family restaurants"]. Drop filler words like "company", "business", "services", "independent", "family-run", and prefer singular. Use the business/industry, not the persona; if the ICP describes people, infer the business type they work at.
- "location": the target area as "City, Country" or "Region, Country" (e.g. "London, UK"). Null if the ICP names no location.
- "countryCode": the 2-letter ISO country code for that location (e.g. "GB", "US"). Null if unknown.
- "personaTitles": 1-4 job titles of the ideal contact person, e.g. ["Practice Manager","Owner"]. Empty array if none implied.

Do not invent a location that isn't in the ICP. Respond with ONLY a JSON object, no other text:
{"searchQueries":["..."],"location":"City, Country" or null,"countryCode":"GB" or null,"personaTitles":["..."]}`;
