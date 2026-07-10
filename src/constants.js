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

/**
 * Maps a free-text search keyword (substring, lowercased) to the OpenStreetMap
 * tags that best represent that business type. Used by the local-business
 * source to turn "dental clinics" into `amenity=dentist` etc. Anything not
 * matched here falls back to a name-based OSM search across business tags.
 */
export const KEYWORD_OSM_TAGS = {
    dentist: ['amenity=dentist', 'healthcare=dentist'],
    dental: ['amenity=dentist', 'healthcare=dentist'],
    orthodont: ['healthcare=dentist'],
    doctor: ['amenity=doctors', 'healthcare=doctor'],
    'gp ': ['amenity=doctors'],
    clinic: ['amenity=clinic', 'healthcare=clinic'],
    hospital: ['amenity=hospital'],
    pharmac: ['amenity=pharmacy'],
    chemist: ['amenity=pharmacy'],
    optician: ['shop=optician'],
    optometr: ['shop=optician'],
    physio: ['healthcare=physiotherapist'],
    vet: ['amenity=veterinary'],
    restaurant: ['amenity=restaurant'],
    cafe: ['amenity=cafe'],
    coffee: ['amenity=cafe'],
    bar: ['amenity=bar', 'amenity=pub'],
    pub: ['amenity=pub'],
    takeaway: ['amenity=fast_food'],
    'fast food': ['amenity=fast_food'],
    bakery: ['shop=bakery'],
    butcher: ['shop=butcher'],
    hotel: ['tourism=hotel'],
    'bed and breakfast': ['tourism=guest_house'],
    'car dealer': ['shop=car'],
    dealership: ['shop=car'],
    'car repair': ['shop=car_repair'],
    garage: ['shop=car_repair'],
    mechanic: ['shop=car_repair'],
    'car wash': ['amenity=car_wash'],
    lawyer: ['office=lawyer'],
    solicitor: ['office=lawyer'],
    attorney: ['office=lawyer'],
    accountant: ['office=accountant'],
    accounting: ['office=accountant'],
    'estate agent': ['office=estate_agent'],
    realtor: ['office=estate_agent'],
    'real estate': ['office=estate_agent'],
    insurance: ['office=insurance'],
    'financial advis': ['office=financial_advisor', 'office=financial'],
    architect: ['office=architect'],
    'travel agent': ['shop=travel_agency'],
    recruit: ['office=employment_agency'],
    gym: ['leisure=fitness_centre', 'amenity=gym'],
    fitness: ['leisure=fitness_centre'],
    spa: ['leisure=spa', 'shop=beauty'],
    salon: ['shop=hairdresser', 'shop=beauty'],
    hairdress: ['shop=hairdresser'],
    barber: ['shop=hairdresser'],
    beauty: ['shop=beauty'],
    nail: ['shop=beauty'],
    tattoo: ['shop=tattoo'],
    plumber: ['craft=plumber'],
    plumbing: ['craft=plumber'],
    electrician: ['craft=electrician'],
    builder: ['craft=builder'],
    construction: ['craft=builder'],
    carpenter: ['craft=carpenter'],
    roofer: ['craft=roofer'],
    painter: ['craft=painter'],
    locksmith: ['craft=locksmith'],
    florist: ['shop=florist'],
    supermarket: ['shop=supermarket'],
    grocery: ['shop=supermarket', 'shop=convenience'],
    clothing: ['shop=clothes'],
    fashion: ['shop=clothes'],
    furniture: ['shop=furniture'],
    hardware: ['shop=hardware'],
    jewel: ['shop=jewelry'],
    bookshop: ['shop=books'],
    bank: ['amenity=bank'],
    school: ['amenity=school'],
    nursery: ['amenity=kindergarten'],
    'estate management': ['office=property_management'],
    'letting agent': ['office=estate_agent'],
    'it company': ['office=it', 'office=company'],
    'software company': ['office=it', 'office=company'],
    'marketing agency': ['office=advertising_agency', 'office=company'],
    consultant: ['office=consulting', 'office=company'],
    printer: ['shop=copyshop', 'craft=printer'],
    'dry clean': ['shop=dry_cleaning'],
    laundry: ['shop=laundry'],
    'pet shop': ['shop=pet'],
    veterinary: ['amenity=veterinary'],
};

// OSM tag families searched by name when a keyword isn't in KEYWORD_OSM_TAGS.
export const OSM_BUSINESS_TAG_FAMILIES = ['amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure'];

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
