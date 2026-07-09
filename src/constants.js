/**
 * Configuration, prompts, scoring rules, and metadata for UK SME Tech Auditor.
 */

export const ACTOR_VERSION = '1.0.0';

export const PRICING = {
    perQualifiedLead: 0.15,
    perThousandAudits: 49,
    trialMinutes: 10,
    apifyMarginPercentage: 30,
};

export const CRAWLER_DEFAULTS = {
    maxRequestsPerCrawl: 100,
    minScoreThreshold: 70,
    maxConcurrency: 3,
    // Each request runs Wappalyzer + Lighthouse + Playwright detection
    // sequentially, each launching its own browser; a full audit routinely
    // takes 60-150+ seconds. A shorter timeout causes Crawlee to reclaim
    // and retry the request while the original attempt's browsers are
    // still running in the background, which can crash the whole process
    // when their operations time out with an unhandled rejection later.
    requestTimeoutSeconds: 300,
};

export const PROXY_CONFIG = {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'GB',
};

export const DECISION_MAKER_TITLES = [
    'CTO',
    'IT Director',
    'Head of IT',
    'Technical Director',
    'Founder',
    'CEO',
    'IT Manager',
];

export const DIRECTORY_DOMAINS = [
    'yell.com',
    'clutch.co',
    ' bark.com',
    ' Thomsonlocal.com',
    '192.com',
    'applegate.co.uk',
    ' yell',
    'clutch',
    'cylex-uk.co.uk',
    'hotfrog.co.uk',
    'foursquare.com',
    'tripadvisor.co.uk',
    'checkatrade.com',
    'trustatrader.com',
    'autotrader.co.uk',
];

export const INDUSTRY_WEIGHTS = {
    automotive: {
        legacyCmsPenalty: 1.0,
        ecommerceImportance: 0.8,
        bookingImportance: 1.2,
        sslImportance: 1.0,
        mobileImportance: 1.1,
    },
    healthcare: {
        legacyCmsPenalty: 1.1,
        ecommerceImportance: 0.5,
        bookingImportance: 1.5,
        sslImportance: 1.5,
        mobileImportance: 1.0,
    },
    retail: {
        legacyCmsPenalty: 1.0,
        ecommerceImportance: 1.5,
        bookingImportance: 0.5,
        sslImportance: 1.2,
        mobileImportance: 1.3,
    },
    logistics: {
        legacyCmsPenalty: 1.2,
        ecommerceImportance: 0.7,
        bookingImportance: 0.8,
        sslImportance: 1.1,
        mobileImportance: 1.0,
    },
    fintech: {
        legacyCmsPenalty: 1.3,
        ecommerceImportance: 0.4,
        bookingImportance: 0.4,
        sslImportance: 1.5,
        mobileImportance: 1.2,
    },
};

export const RULE_BASED_WEIGHTS = {
    wordpressOld: 40,
    hasItJobPostings: 30,
    noBookingSystem: 15,
    sslMissing: 10,
    ecommerceSlowCheckout: 20,
    jQueryPresent: 10,
    noAnalytics: 10,
    mobilePerformanceLow: 15,
};

export const EMAIL_TEMPLATES = {
    automotive: {
        subject: 'Speed up your dealership website and free up your team',
        opener: 'I noticed your dealership site is running on older tech that may be slowing down your online enquiries.',
        angle: 'Glosix Systems provides UK automotive dealers with vetted remote developers who modernise websites, integrate DMS systems, and cut IT backlog.',
    },
    healthcare: {
        subject: 'Secure, compliant IT support for your practice',
        opener: 'Your practice website handles sensitive patient data — outdated tech or missing SSL can put compliance at risk.',
        angle: 'Glosix Systems supplies GDPR-aware developers and IT specialists to UK healthcare providers on flexible staff augmentation contracts.',
    },
    retail: {
        subject: 'Recover lost checkout revenue with a stronger dev team',
        opener: 'Slow mobile checkout and legacy platforms are costing UK retailers sales every day.',
        angle: 'Glosix Systems embeds e-commerce developers into retail teams to fix checkout friction, upgrade platforms, and launch faster.',
    },
    logistics: {
        subject: 'Reduce manual ops with dedicated development resource',
        opener: 'Logistics companies live or die by system reliability — technical debt quickly becomes delivery debt.',
        angle: 'Glosix Systems places logistics-savvy developers who build integrations, dashboards, and automation for UK transport firms.',
    },
    fintech: {
        subject: 'Scale your engineering team without permanent hires',
        opener: 'Fintech moves fast; hiring permanent senior engineers in the UK is expensive and slow.',
        angle: 'Glosix Systems provides FCA-aware remote developers, QA engineers, and cloud specialists on demand.',
    },
};

export const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

export const LLM_SYSTEM_PROMPT = `You are a UK IT Staff Augmentation sales expert with 15 years experience.
Analyze this company website audit and score 0-100 on outsourcing likelihood.

SCORING RULES:
- WordPress + no recent updates + performance <50 = +40 points
- Has IT job postings on LinkedIn = +30 points
- No booking system in 2024 = +15 points
- SSL missing = +10 points
- E-commerce but slow checkout = +20 points
- jQuery still present = +10 points
- No analytics = +10 points
- Mobile performance <30 = +15 points

SCORE INTERPRETATION:
- 80-100 = "Hot lead — call this week"
- 60-79 = "Warm lead — nurture with case study"
- 40-59 = "Cold — monitor quarterly"
- 0-39 = "Ignore"

OUTPUT FORMAT (JSON only):
{
  "score": number,
  "painPoints": ["string"],
  "reasoning": "string",
  "glosixPitchAngle": "string",
  "recommendedApproach": "string"
}`;

export const KNOWN_CMS = ['WordPress', 'Shopify', 'Wix', 'Squarespace', 'Drupal', 'Joomla', 'Magento', 'BigCommerce'];
export const KNOWN_FRAMEWORKS = ['React', 'Vue.js', 'Angular', 'jQuery', 'Next.js', 'Nuxt.js', 'Svelte', 'Gatsby'];
export const KNOWN_ANALYTICS = ['Google Analytics', 'Google Tag Manager', 'Hotjar', 'Mixpanel', 'Amplitude', 'Plausible', 'Matomo'];
export const KNOWN_ECOMMERCE = ['Shopify', 'Magento', 'WooCommerce', 'BigCommerce', 'PrestaShop', 'OpenCart', 'Squarespace Commerce'];

export const SCORE_LABELS = {
    hot: 'Hot lead — call this week',
    warm: 'Warm lead — nurture with case study',
    cold: 'Cold — monitor quarterly',
    ignore: 'Ignore',
};
