# 🇬🇧 UK SME Tech Stack Auditor & IT Outsourcing Lead Scorer

An Apify Actor that audits UK SME websites, scores their likelihood of needing IT staff augmentation / outsourcing, and enriches hot leads with decision-maker contact data.

Built for **Glosix Systems** and published on the **Apify Marketplace**.

---

## What this Actor does

1. **Crawls start URLs** — company websites or directory pages (Yell, Clutch, Autotrader dealers, etc.).
2. **Detects technology** — CMS, frameworks, analytics, e-commerce platforms, server software using Wappalyzer.
3. **Audits performance** — runs Lighthouse for Performance, SEO, and Best Practices scores.
4. **Checks digital maturity** — SSL, booking systems, contact forms, e-commerce, page load time, mobile responsiveness.
5. **Scores outsourcing likelihood** — 0-100 using an open-source LLM via Ollama, with rule-based fallback.
6. **Enriches high-scoring leads** — finds CTO / IT Director / Founder profiles via Proxycurl.
7. **Exports results** — structured JSON to Apify Dataset and CSV to Key-Value Store.

---

## Input schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `startUrls` | array | yes | — | List of URLs to start crawling. Can be company sites or directories. |
| `maxRequestsPerCrawl` | integer | no | `100` | Max pages to process (1-1000). |
| `minScoreThreshold` | integer | no | `70` | Only enrich leads with score ≥ this. |
| `industry` | string | no | `automotive` | Target industry: `automotive`, `healthcare`, `retail`, `logistics`, `fintech`. |
| `companySize` | string | no | `SME` | Target size: `startup`, `SME`, `enterprise`. |
| `enableEnrichment` | boolean | no | `true` | Enable Proxycurl decision-maker enrichment. |
| `proxycurlApiKey` | string | conditional | — | Required if `enableEnrichment` is true. |
| `ollamaBaseUrl` | string | no | `http://localhost:11434` | URL of your Ollama server. |
| `ollamaModel` | string | no | `llama3.2` | Open-source model to use (must be pulled). |
| `outputFormat` | string | no | `both` | `json`, `csv`, or `both`. |

### Example input

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
  "proxycurlApiKey": "YOUR_PROXYCURL_KEY",
  "ollamaBaseUrl": "http://localhost:11434",
  "ollamaModel": "llama3.2",
  "outputFormat": "both"
}
```

---

## Output schema

Each record pushed to the Apify Dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Audited website URL. |
| `companyName` | string | Extracted company name or domain fallback. |
| `industry` | string | Input industry. |
| `companySize` | string | Input company size. |
| `techStack` | array | Detected technologies. |
| `lighthousePerformance` | number | Lighthouse performance score (0-100). |
| `lighthouseSeo` | number | Lighthouse SEO score (0-100). |
| `lighthouseBestPractices` | number | Lighthouse best practices score (0-100). |
| `hasSsl` | boolean | Whether HTTPS is active. |
| `hasBookingSystem` | boolean | Booking/appointment signals detected. |
| `hasEcommerce` | boolean | E-commerce signals detected. |
| `hasContactForm` | boolean | Contact form detected. |
| `pageLoadTime` | number | Navigation-to-load timing in ms. |
| `outsourcingScore` | number | 0-100 AI/rule-based score. |
| `painPoints` | array | Identified pain points. |
| `reasoning` | string | Why the score was given. |
| `glosixPitchAngle` | string | Suggested sales pitch. |
| `recommendedApproach` | string | Recommended outreach action. |
| `decisionMaker` | object \| null | `{ name, title, linkedinUrl, email }` |
| `enrichmentStatus` | string | `enriched`, `pending`, or `skipped`. |
| `scrapedAt` | string | ISO timestamp. |
| `actorVersion` | string | Actor version. |

CSV output flattens nested objects (e.g. `decisionMaker.name` becomes `decisionMakerName`).

---

## Setup

### Ollama (open-source LLM)

This actor uses [Ollama](https://ollama.com/) to run open-source models locally. No paid AI API is required.

1. Install Ollama: [https://ollama.com/download](https://ollama.com/download)
2. Pull a verified model:
   ```bash
   ollama pull llama3.2
   ```
3. Ensure Ollama is running (default: `http://localhost:11434`).
4. Set `ollamaBaseUrl` and `ollamaModel` in the input. If Ollama is unreachable, the actor falls back to rule-based scoring.

> For Apify cloud runs you must expose an Ollama instance the actor can reach, or disable AI scoring and rely on the built-in rule-based fallback.

### Proxycurl API key

1. Sign up at [https://nubela.co/proxycurl](https://nubela.co/proxycurl)
2. Copy your API key from the dashboard.
3. Paste it into the `proxycurlApiKey` input field.
4. The actor respects Proxycurl rate limits (max 10 requests/minute).

---

## Sample use cases

### Automotive
Generate leads for an IT outsourcing agency serving UK car dealerships. Target directories like Yell or Autotrader dealer pages, score sites with outdated WordPress / no booking systems, and enrich CTO/Founder contacts.

### Healthcare
Audit GP practices, dental clinics, and care providers. Prioritise SSL compliance, online booking, and mobile performance. Pitch GDPR-aware remote developers.

### Retail
Find independent UK retailers with slow Shopify/Magento/WooCommerce sites. Recommend checkout optimisation and platform upgrades.

### Logistics
Score haulage and courier firms on legacy systems, missing booking portals, and mobile performance.

### Fintech
Identify smaller fintechs and financial advisers with outdated web stacks and pitch scalable remote engineering teams.

---

## Pricing on Apify Store

- **$0.15 per qualified lead** (score ≥ threshold), **or**
- **$49 per 1,000 audited sites**.
- **10-minute free trial** included.
- Apify platform margin already configured at 30%.

---

## Local testing

```bash
# Install dependencies
npm install

# Run with Apify CLI (requires Apify account + proxy access)
apify run -p

# Or run directly with input file
APIFY_TOKEN=xxx apify run -p --input=input.json
```

> Note: `apify run -p` uses Apify Proxy. You need an Apify account with proxy access.

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Ollama scoring failed` | Ollama not running or model not pulled | Start Ollama and pull the model. Fallback rule-based scoring still runs. |
| `Proxycurl HTTP 429` | Rate limit hit | The actor already rate-limits to 10 req/min; wait and retry. |
| `Lighthouse scores are null` | Chrome launch failed | The actor falls back to Playwright timing APIs. |
| `Wappalyzer returned no tech` | Site blocks detection | The actor falls back to meta-tag detection. |
| `No leads enriched` | Score threshold too high | Lower `minScoreThreshold` or verify Proxycurl key. |
| `Directory not detected` | Unknown domain | Add custom start URLs directly as company sites. |

---

## Security & compliance

- API keys are read from Apify input / environment variables — **never hardcoded**.
- Proxycurl key is marked as a secret input and never logged.
- Output contains only extracted structured data — no raw HTML.
- The actor uses UK residential proxies (`countryCode: GB`) for local relevance.

---

## Author

**Glosix Systems** — IT Staff Augmentation for UK SMEs.
