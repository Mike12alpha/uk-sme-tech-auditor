# 🎯 MASTER PROMPT: UK SME TECH STACK AUDITOR + IT OUTSOURCING LEAD SCORER

## CONTEXT
I am building an Apify Actor to be used internally by my company **Glosix Systems** (IT Staff Augmentation) and also published on the **Apify Marketplace** for revenue. I have a UK automotive client (Speed Auto Systems) and need to generate qualified IT outsourcing leads from UK SMEs.

---

## OBJECTIVE
Build a complete, production-ready Apify Actor called `uk-sme-tech-auditor` that:
1. Takes a list of UK company websites or industry directory URLs
2. Audits each site's tech stack, performance, and digital maturity
3. Scores each company 0-100 on "IT Staff Augmentation / Outsourcing Likelihood"
4. Enriches high-scoring leads with decision maker data (CTO/IT Director/Founder)
5. Outputs structured JSON + CSV ready for sales outreach
6. Is publishable on Apify Store with monetization built-in

---

## TECH STACK (MANDATORY — USE EXACTLY THESE)

| Component | Technology |
|-----------|-----------|
| Actor Framework | **Apify SDK v3** (Node.js) |
| Browser Automation | **Playwright** with stealth plugins |
| Tech Detection | **Wappalyzer** (npm package) |
| Performance Audit | **Lighthouse** (Node module) |
| AI Scoring | **OpenAI GPT-4o-mini API** |
| Lead Enrichment | **Proxycurl API** (for LinkedIn data) |
| Proxy | **Apify Proxy** (RESIDENTIAL, countryCode: GB) |
| Data Storage | Apify **Dataset** + **Key-Value Store** |
| Output Format | JSON (Dataset) + CSV (Key-Value Store) |
| Environment | Node.js 18+ |

---

## FILE STRUCTURE (CREATE ALL THESE FILES)

```
uk-sme-tech-auditor/
├── .actor/
│   ├── actor.json          # Apify actor definition
│   └── Dockerfile          # Container config
├── src/
│   ├── main.js             # Entry point & crawler setup
│   ├── routes.js           # Request handlers (Playwright)
│   ├── techAuditor.js      # Wappalyzer + Lighthouse integration
│   ├── aiScorer.js         # OpenAI scoring logic
│   ├── enricher.js         # Proxycurl enrichment for decision makers
│   ├── utils.js            # Helpers, formatters, validators
│   └── constants.js        # Config, prompts, scoring rules
├── storage/
│   └── templates/          # Email templates, pitch angles
├── package.json
├── README.md               # For Apify Store + internal docs
└── INPUT_SCHEMA.json       # Apify input configuration
```

---

## DETAILED FUNCTIONAL REQUIREMENTS

### 1. INPUT_SCHEMA.json

Must accept these inputs:
- `startUrls`: Array of URLs (company websites or directory pages)
- `maxRequestsPerCrawl`: Number (default: 100, max: 1000)
- `minScoreThreshold`: Number (default: 70, range: 0-100)
- `industry`: String (default: "automotive", options: automotive, healthcare, retail, logistics, fintech)
- `companySize`: String (default: "SME", options: startup, SME, enterprise)
- `enableEnrichment`: Boolean (default: true)
- `proxycurlApiKey`: String (required if enrichment enabled)
- `openaiApiKey`: String (required)
- `outputFormat`: String (default: "both", options: json, csv, both)

### 2. src/main.js — Entry Point

- Initialize Apify Actor
- Read input from `Actor.getInput()`
- Create PlaywrightCrawler with:
  - `maxRequestsPerCrawl` from input
  - Proxy configuration: `RESIDENTIAL` group, `countryCode: 'GB'`
  - Request handler from `routes.js`
- Run crawler on `startUrls`
- After crawl completes:
  - If `enableEnrichment` is true, call `enricher.enrichHighScoringLeads(minScoreThreshold)`
  - Generate CSV from dataset and save to Key-Value Store
  - Log summary: total audited, hot leads (score>80), warm leads (60-80), cold (<60)

### 3. src/routes.js — Request Handler

For each URL:
- Detect if it's a **directory page** (Yell, Clutch, industry association) or **company website**
- If directory: Extract all company website links, add them to crawler queue
- If company website:
  - Call `techAuditor.audit(url, page)` to get tech stack + performance data
  - Call `aiScorer.score(techData, industry, companySize)` to get 0-100 score
  - Push result to Apify Dataset with this exact schema:

```javascript
{
  url: string,
  companyName: string,
  industry: string,
  companySize: string,
  techStack: array of strings,
  lighthousePerformance: number,
  lighthouseSeo: number,
  lighthouseBestPractices: number,
  hasSsl: boolean,
  hasBookingSystem: boolean,
  hasEcommerce: boolean,
  hasContactForm: boolean,
  pageLoadTime: number,
  outsourcingScore: number,
  painPoints: array of strings,
  reasoning: string,
  glosixPitchAngle: string,
  recommendedApproach: string,
  decisionMaker: {
    name: string,
    title: string,
    linkedinUrl: string,
    email: string // if available
  } | null,
  enrichmentStatus: "enriched" | "pending" | "skipped",
  scrapedAt: ISO timestamp,
  actorVersion: string
}
```

### 4. src/techAuditor.js — Tech Stack Detection

- Use **Wappalyzer** to detect:
  - CMS (WordPress, Shopify, Wix, etc.)
  - Frameworks (React, Vue, Angular, jQuery)
  - Analytics (Google Analytics, Hotjar, etc.)
  - E-commerce platforms
  - Server software
- Use **Lighthouse** (via `lighthouse` + `chrome-launcher`) to score:
  - Performance (0-100)
  - SEO (0-100)
  - Best Practices (0-100)
- Use Playwright to detect:
  - SSL certificate validity
  - Presence of booking/contact forms
  - Page load time (navigationStart to loadEventEnd)
  - Mobile responsiveness hint
- Return structured object with all findings

### 5. src/aiScorer.js — AI Scoring Engine

- Use OpenAI GPT-4o-mini with JSON mode
- System prompt must be:

```
You are a UK IT Staff Augmentation sales expert with 15 years experience.
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
}
```

- Cache results in Key-Value Store to avoid duplicate OpenAI calls for same domain
- Handle API errors gracefully (fallback to rule-based scoring if OpenAI fails)

### 6. src/enricher.js — Decision Maker Enrichment

- Filter dataset for leads with `outsourcingScore >= minScoreThreshold`
- For each high-scoring lead:
  - Call Proxycurl API: `POST https://nubela.co/proxycurl/api/linkedin/company/employee/search/`
  - Search for titles containing: "CTO", "IT Director", "Head of IT", "Technical Director", "Founder", "CEO", "IT Manager"
  - Get: name, title, LinkedIn URL, email (if available)
  - Update dataset record with enrichment data
- Rate limit: Max 10 requests/minute to respect Proxycurl limits
- Log enrichment progress

### 7. src/utils.js — Helpers

- `extractDomain(url)` — Clean domain extraction
- `isDirectoryPage(url)` — Detect Yell, Clutch, etc.
- `formatDate(date)` — ISO timestamp
- `generateCsv(dataset)` — Convert JSON dataset to CSV with all fields
- `calculateLeadQuality(score)` — "Hot", "Warm", "Cold", "Ignore"
- `retryAsync(fn, retries=3)` — Exponential backoff for API calls

### 8. src/constants.js — Configuration

- Industry-specific scoring weights
- UK proxy settings
- Apify Store pricing metadata
- Email template snippets for each industry
- Default user agents

### 9. .actor/actor.json

```json
{
  "actorSpecification": 1,
  "name": "uk-sme-tech-auditor",
  "title": "UK SME Tech Stack Auditor & IT Outsourcing Lead Scorer",
  "description": "Audits UK SME websites for tech debt, scores outsourcing likelihood 0-100, and enriches with decision maker contact data. Perfect for IT staff augmentation agencies.",
  "version": "1.0",
  "meta": {
    "categories": ["Marketing", "AI", "Lead Generation"],
    "pricing": {
      "pricingModel": "PAY_PER_RESULT",
      "trialMinutes": 10,
      "apifyMarginPercentage": 30
    }
  },
  "input": "./INPUT_SCHEMA.json",
  "dockerfile": "./.actor/Dockerfile"
}
```

### 10. README.md

Must include:
- What the actor does
- Input schema explanation with examples
- Output schema documentation
- How to get Proxycurl API key
- How to get OpenAI API key
- Sample use cases (automotive, healthcare, retail)
- Pricing explanation for Apify Store
- Troubleshooting section

---

## DEPLOYMENT REQUIREMENTS

### Local Testing
- Must run with `apify run -p` (with proxy) successfully
- Must handle at least 50 URLs without memory crashes
- Must output valid CSV that opens correctly in Excel/Google Sheets

### Apify Publish
- Must pass Apify actor validation
- Must include icon (generate a simple SVG: magnifying glass + UK flag + code brackets)
- Must set pricing to **$0.15 per qualified lead** or **$49 per 1,000 audited sites**
- Must include 10-minute free trial

---

## ERROR HANDLING & EDGE CASES

- If Wappalyzer fails → fallback to basic meta tag detection
- If Lighthouse fails → use Playwright timing APIs only
- If OpenAI fails → use rule-based scoring (predefined weights in constants.js)
- If Proxycurl fails → mark enrichment as "pending", don't crash
- If site blocks scraping → rotate proxy, retry once, then skip
- If company name not found → use domain name as fallback
- Handle infinite scroll directories (Yell) with pagination limits

---

## PERFORMANCE REQUIREMENTS

- Max 30 seconds per website audit
- Max 5 seconds per OpenAI call (use GPT-4o-mini)
- Max 3 concurrent pages to avoid memory issues
- Clean up Chrome instances after each Lighthouse run (prevent zombie processes)

---

## SECURITY

- API keys must be read from `process.env` or Apify input, NEVER hardcoded
- Proxycurl key must be stored in Apify environment variables, not logged
- Output must not contain raw HTML (only extracted data)
- Respect robots.txt (skip if Disallow: /)

---

## DELIVERABLES CHECKLIST

Before saying "done", verify:
- [ ] `apify run` completes successfully on 10 test URLs
- [ ] Output JSON has all 20+ fields specified
- [ ] CSV export works and has headers
- [ ] Enrichment only runs for score >= threshold
- [ ] README is complete and professional
- [ ] Actor.json is valid and passes `apify validate`
- [ ] Pricing is set for Apify Store
- [ ] No hardcoded API keys anywhere
- [ ] Error handling works for all 6 failure scenarios
- [ ] Dockerfile builds without errors

---

## TEST INPUT (USE THIS TO VERIFY)

```json
{
  "startUrls": [
    { "url": "https://www.yell.com/ucs/UcsSearchAction.do?keywords=car+dealerships&location=London" },
    { "url": "https://www.autotrader.co.uk/dealers" }
  ],
  "maxRequestsPerCrawl": 50,
  "minScoreThreshold": 70,
  "industry": "automotive",
  "companySize": "SME",
  "enableEnrichment": true,
  "proxycurlApiKey": "YOUR_KEY_HERE",
  "openaiApiKey": "YOUR_KEY_HERE",
  "outputFormat": "both"
}
```

---

## FINAL INSTRUCTION

Build this actor completely from scratch. Write every file. Do not skip any component. Make it production-ready, not a prototype. This is going live on Apify Store and generating real revenue for Glosix Systems. Optimize for reliability, not speed of coding.
