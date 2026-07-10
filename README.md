# Universal Lead Generator

An Apify Actor that generates B2B/B2C leads for **any industry and any target persona** by combining four independent lead sources — Google Maps, LinkedIn, business directories, and general web search — then scores every lead against your own Ideal Customer Profile (ICP) using Groq's hosted LLM API.

This replaces an earlier, narrowly-scoped "UK SME Tech Auditor" actor that only audited website tech stacks for one industry. This version is fully generic: you describe who you're looking for in plain English, and it goes and finds them.

---

## How it works

1. **You describe your ICP** in plain text — industry, persona/job titles, company size, region, pain points, whatever matters to you.
2. **Four sources run independently** (toggle any of them off):
   - **Google Maps** — local/regional businesses matching your search queries (name, address, phone, website, rating, category). Delegates to the specialist `compass/crawler-google-places` Actor rather than scraping Google directly — see [Limitations](#limitations) for why.
   - **LinkedIn** — decision-makers matching your persona job titles, discovered via public search-engine indexing (no login/cookies required, so no LinkedIn account is put at risk — see [Limitations](#limitations)).
   - **Business directories** — Yell and similar listing sites, or your own directory URLs; extracts outbound company links.
   - **General web search** — finds company websites directly by keyword + location, for industries with no strong directory/Maps presence.
3. **Leads are deduped and merged** across sources — a Google Maps business and a LinkedIn person at the same company become one combined lead where possible.
4. **Website enrichment** visits each company's site (and contact page) for emails, phone numbers, and social links. If no email is found but a person's name + domain are known, it guesses common email patterns and keeps the guess only if the domain actually has mail servers (MX record) — this is a heuristic, not a real verification.
5. **Every lead is scored 0-100 against your ICP** using Groq (or a rule-based fallback if no API key is supplied).
6. **Results export** to the Apify Dataset, plus CSV/JSON in the Key-Value Store.

---

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `icpDescription` | string | **yes** | — | Free text: who you're targeting. Drives the LLM's scoring. |
| `searchQueries` | array | no | — | Google Maps search terms, e.g. `["dental clinics"]`. Leave empty to skip Google Maps. |
| `keywords` | array | no | `searchQueries` | Keywords used to build LinkedIn / directory / web-search queries. |
| `personaTitles` | array | no | generic owner/founder/director list | Job titles to search for on LinkedIn. |
| `location` | string | no | — | City/region/country, used across all sources. |
| `countryCode` | string | no | — | 2-letter code for residential proxy routing (e.g. `GB`, `US`). |
| `directoryUrls` | array | no | auto-built Yell search | Specific directory listing URLs to crawl. |
| `sources` | array | no | all four | Which sources to run: `googleMaps`, `linkedin`, `directory`, `webSearch`. |
| `maxResultsPerSource` | integer | no | `50` | Cap per source per query. |
| `minScoreThreshold` | integer | no | `0` | Only export leads scoring at/above this. |
| `enrichWebsites` | boolean | no | `true` | Visit each lead's website for contact data. |
| `fetchLinkedInPublicProfiles` | boolean | no | `true` | Best-effort fetch of each LinkedIn profile's public page. |
| `groqApiKey` | string (secret) | no | — | Enables Groq-based LLM scoring. Without it, a rule-based fallback is used. |
| `groqModel` | string | no | `llama-3.3-70b-versatile` | Groq model for scoring. |
| `outputFormat` | string | no | `both` | `json`, `csv`, or `both`. |

### Example input

```json
{
  "icpDescription": "UK-based independent dental clinics with 5-30 staff. Best contacts are the Practice Manager or Owner. Looking for practices without an online booking system.",
  "searchQueries": ["dental clinics"],
  "personaTitles": ["Practice Manager", "Owner"],
  "location": "London, UK",
  "countryCode": "GB",
  "groqApiKey": "YOUR_GROQ_API_KEY"
}
```

---

## Output schema

Every record in the Apify Dataset is a unified lead, regardless of which source(s) it came from:

| Field | Description |
|---|---|
| `source` | `google_maps`, `linkedin`, `directory`, or `web_search`. |
| `type` | `company` or `person`. |
| `companyName`, `personName`, `jobTitle` | Who/what the lead is. |
| `website`, `domain` | Company website and root domain. |
| `email`, `emailStatus` | `found` (scraped) or `guessed` (pattern + MX check). |
| `phone`, `address`, `city`, `country` | Contact/location details. |
| `linkedinUrl`, `socialLinks` | Social profiles found. |
| `rating`, `reviewsCount`, `category` | Google Maps fields (null for other sources). |
| `icpScore` | 0-100 fit score from the LLM (or the rule-based fallback). |
| `matchedPersona`, `icpReasoning`, `suggestedApproach` | The LLM's scoring explanation and outreach suggestion. |
| `sourceUrl`, `scrapedAt`, `actorVersion` | Provenance. |

CSV output flattens `socialLinks` into `facebook` / `twitter` / `instagram` columns.

---

## Setup

### Groq API key
Get one at [console.groq.com/keys](https://console.groq.com/keys), paste it into `groqApiKey`. Without it, leads are still scored, just with a much cruder rule-based heuristic instead of an LLM.

### Proxy
Uses Apify Proxy (RESIDENTIAL group) by default, falling back to standard datacenter proxy if your account doesn't have residential access, for the LinkedIn/directory/web-search sources and website enrichment (all plain HTTP via Cheerio).

Confirmed in testing: DuckDuckGo's HTML endpoint (used for the LinkedIn and web-search sources) resets the TLS connection consistently — across multiple retries with different rotated proxy sessions — suggesting DuckDuckGo blocks Apify's residential proxy IP range at the network level, not simple rate-limiting. These two sources already throttle their own requests and run at `maxConcurrency: 1`, but expect them to fail gracefully (0 leads, no crash) rather than reliably return results until/unless that changes.

### Google Maps costs money beyond your own Actor's usage
The Google Maps source calls `compass/crawler-google-places` on your behalf (via `Actor.call()`), which bills separately at roughly **$0.003–0.004 per place scraped** (Apify Store pricing, varies by your account tier) on top of whatever your own Actor run costs. `maxResultsPerSource` bounds how many places it asks for per query.

---

## Limitations

- **Google Maps**: this actor does not scrape Google Maps directly. Confirmed in production testing: a raw Playwright scraper going through Apify's residential proxy had every navigation to `google.com/maps` silently tarpitted — a consistent ~45s hang on every single run, with the page becoming unresponsive even to a screenshot attempt, regardless of country targeting. That's consistent with Google's anti-bot system detecting and stalling known proxy-network traffic rather than returning a clean block signal. Rather than fight that, this source delegates to `compass/crawler-google-places`, an established, high-volume Actor that already solves this problem (see the cost note above).
- **LinkedIn**: this actor does **not** log into LinkedIn or use session cookies — that requires handing over a real account, which risks that account being banned and carries real ToS/legal exposure (see *hiQ Labs v. LinkedIn* and LinkedIn's active anti-scraping enforcement). Instead it discovers public profiles indexed by search engines (DuckDuckGo) and parses name/title/company straight out of the search snippet — that snippet data is the main payload. The optional public-profile-page fetch (`fetchLinkedInPublicProfiles`) is a bonus-only layer: in testing, LinkedIn returns an immediate bot-block response (HTTP 999) to anonymous, cookie-less requests essentially every time, proxy or not, so treat any extra fields it adds as a bonus, not something to rely on. This is a deliberate trade-off — real coverage in exchange for zero risk to a LinkedIn account.
- **Email guesses** are pattern-based heuristics confirmed only by a DNS MX lookup (does the domain receive mail at all) — not a real SMTP/deliverability check. Treat `emailStatus: "guessed"` accordingly.
- **Directories/web search** rely on plain HTTP + HTML parsing (no JS execution). Confirmed in testing: **Yell.com sits behind Cloudflare and returns HTTP 403 to plain requests** — the built-in auto-generated Yell query (used only when you don't supply `directoryUrls`) will typically yield zero results out of the box for that reason, not a bug in the parsing logic. For real directory coverage, supply `directoryUrls` pointing at directories that don't challenge plain HTTP clients (many smaller/regional directories don't), or lean on the Google Maps / LinkedIn / web-search sources instead, which don't have this problem.

---

## Local testing

```bash
npm install
apify run -p --input=input.json
```

> `apify run -p` uses Apify Proxy and requires an Apify account with proxy access.

---

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `Google Maps: 0 places found` | `compass/crawler-google-places` call failed or returned nothing for the query | Check the run log for the sub-Actor's own error; try a narrower/more specific `searchQueries` term. |
| `LinkedIn: 0 leads` | DuckDuckGo returned no indexed results for the query | Broaden `personaTitles`/`keywords`, or DuckDuckGo itself blocked the request — retry later. |
| Lots of `emailStatus: null` | No email found on-site or via contact page, and no MX-verified guess possible | Expected for sites with no visible email; lower your expectations for those leads rather than treating it as a bug. |
| `AI scoring failed` in `icpReasoning` | Groq API error (bad key, rate limit, network) | Check `groqApiKey`; the actor still runs using the rule-based fallback. |
| Few directory results | Target directory is JS-rendered | Supply direct company URLs via `searchQueries`/`keywords` for the other sources instead. |

---

## Security & compliance

- API keys are read from Actor input only — never hardcoded or logged.
- `groqApiKey` is marked as a secret input.
- No LinkedIn credentials/cookies are ever requested or used.
- Output contains only extracted structured data — no raw HTML.
- Directory/web-search crawling reads target site `robots.txt` where practical.
