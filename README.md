# Universal Lead Generator

An Apify Actor that generates B2B/B2C leads for **any industry and any target persona** by combining four independent lead sources — local businesses (OpenStreetMap), LinkedIn, business directories, and general web search — then scores every lead against your own Ideal Customer Profile (ICP) using Groq's hosted LLM API.

This replaces an earlier, narrowly-scoped "UK SME Tech Auditor" actor that only audited website tech stacks for one industry. This version is fully generic: you describe who you're looking for in plain English, and it goes and finds them.

---

## How it works

1. **You describe your ICP** in plain text — industry/business type, persona/job titles, company size, region, pain points, whatever matters to you. This is the only field you really need: if you leave `searchQueries` / `location` / `personaTitles` empty, the actor uses Groq to **derive them straight from your ICP** (e.g. *"UK dental practices in London, reach the Practice Manager"* → searchQueries `["dental practices"]`, location `"London, UK"`, personaTitles `["Practice Manager","Owner"]`). Anything you do fill in yourself always wins. (Auto-derivation needs a Groq key.)
2. **Four sources run independently** (toggle any of them off). Each source has a built-in crawler that works on any plan; three of them can *optionally* use a paid external Apify Actor for richer data (see [Using external Apify Actors](#using-external-apify-actors-paid)):
   - **Local business** — built-in: our own crawler over the open OpenStreetMap data APIs. Optional external: `compass/crawler-google-places` (real Google Maps data + ratings). See [Limitations](#limitations) for why the built-in default is OpenStreetMap, not Google Maps.
   - **LinkedIn** — decision-makers matching your persona job titles, discovered via public search-engine indexing (no login/cookies required, so no LinkedIn account is put at risk — see [Limitations](#limitations)).
   - **Business directories** — Yell and similar listing sites, or your own directory URLs; extracts outbound company links.
   - **General web search** — finds company websites directly by keyword + location, for industries with no strong directory/Maps presence.
3. **Leads are deduped and merged** across sources — a local business and a LinkedIn person at the same company become one combined lead where possible.
4. **Website enrichment** visits each company's site (and contact page) for emails, phone numbers, and social links. If no email is found but a person's name + domain are known, it guesses common email patterns and keeps the guess only if the domain actually has mail servers (MX record) — this is a heuristic, not a real verification.
5. **Every lead is scored 0-100 against your ICP** using Groq (batched — ~10 leads per call), or a rule-based fallback if no API key is supplied.
6. **Results export** to the Apify Dataset, plus CSV/JSON in the Key-Value Store, sorted best-first.

**Scale:** set `maxResultsPerSource` to how many leads you want per search term — 50, 500, or a few thousand. The local business source grid-searches OpenStreetMap (splitting the area into tiles) to reach large targets. **Cross-run cache:** results for a `(search term + location)` are stored in a named Key-Value Store, so a repeat run returns them instantly from storage instead of re-scraping (and keeps load off the free OSM service).

---

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `icpDescription` | string | **yes** | — | Free text: who you're targeting. Drives the LLM's scoring **and** — when the fields below are empty — the auto-derivation of search terms/location/persona. |
| `searchQueries` | array | no | *derived from ICP* | Local-business search terms, e.g. `["dental clinics"]`. Empty ⇒ derived from the ICP (needs Groq key). Needs `location`. |
| `keywords` | array | no | `searchQueries` | Keywords used to build LinkedIn / directory / web-search queries. |
| `personaTitles` | array | no | *derived from ICP* | Ideal-contact job titles. Empty ⇒ derived from the ICP (needs Groq key), else a generic owner/founder/director list. |
| `location` | string | no | *derived from ICP* | City/region/country. **Required** for the local business source (geocoded to a search area). Empty ⇒ derived from the ICP (needs Groq key). |
| `countryCode` | string | no | *derived from ICP* | 2-letter code (e.g. `GB`, `US`) for proxy routing. Empty ⇒ derived from the ICP/location. |
| `directoryUrls` | array | no | auto-built Yell search | Specific directory listing URLs to crawl. |
| `sources` | array | no | all four | Which sources to run: `localBusiness`, `linkedin`, `directory`, `webSearch`. (Legacy `googleMaps` is accepted as an alias for `localBusiness`.) |
| `maxResultsPerSource` | integer | no | `100` | Target leads per source, per search term. Local business grid-searches OSM to reach large targets (up to `5000`). |
| `minScoreThreshold` | integer | no | `0` | Only export leads scoring at/above this. |
| `enrichWebsites` | boolean | no | `true` | Visit each lead's website (+ up to 2 contact/about pages) for email/phone/socials. |
| `maxEnrichWebsites` | integer | no | `300` | Cap on how many websites to visit for enrichment (bounds run time at scale). |
| `useCache` | boolean | no | `true` | Serve repeat `(term + location)` results from the cross-run cache. |
| `cacheMaxAgeDays` | integer | no | `7` | How long cached results stay valid. |
| `onlyLeadsWithContact` | boolean | no | `false` | Drop leads with no email/phone/website before scoring & export. |
| `maxLeads` | integer | no | `0` | Hard cap on exported (highest-scoring) leads. `0` = no cap. |
| `fetchLinkedInPublicProfiles` | boolean | no | `true` | Best-effort fetch of each LinkedIn profile's public page. |
| `useApifyActors` | boolean | no | `false` | Try paid external Apify Actors (Maps/LinkedIn/directory) first, fall back to built-in crawlers. See [Using external Apify Actors](#using-external-apify-actors-paid). |
| `mapsActorId` | string | no | `compass/crawler-google-places` | External Google Maps Actor (only used when `useApifyActors` is on). |
| `linkedinActorId` | string | no | `harvestapi/linkedin-profile-search` | External LinkedIn Actor (only used when `useApifyActors` is on). |
| `directoryActorId` | string | no | — | Optional external directory Actor (only used when `useApifyActors` is on). Empty = always use the built-in directory crawler. |
| `groqApiKey` | string (secret) | no | — | Enables Groq-based LLM scoring. Without it, a rule-based fallback is used. |
| `groqModel` | string | no | `llama-3.3-70b-versatile` | Groq model for scoring. |
| `outputFormat` | string | no | `both` | `json`, `csv`, or `both`. |

### Example input

**Minimal — just describe your ICP** (with a Groq key set, the rest is derived automatically):

```json
{
  "icpDescription": "UK independent dental practices in London, reaching the Practice Manager or Owner.",
  "sources": ["localBusiness"]
}
```

**Explicit — spell out the search yourself** (works without a Groq key too):

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
| `source` | `local_business`, `linkedin`, `directory`, or `web_search`. |
| `type` | `company` or `person`. |
| `companyName`, `personName`, `jobTitle` | Who/what the lead is. |
| `website`, `domain` | Company website and root domain. |
| `email`, `emailStatus` | `found` (scraped) or `guessed` (pattern + MX check). |
| `phone`, `address`, `postcode`, `city`, `country` | Contact/location details. |
| `latitude`, `longitude` | Coordinates (local business source; null elsewhere). |
| `linkedinUrl`, `socialLinks` | Social profiles found. |
| `rating`, `reviewsCount` | Always null (OpenStreetMap has no ratings/reviews). |
| `leadQuality` | `Hot lead` (≥80), `Warm lead` (60–79), `Cold lead` (40–59), or `Ignore` (<40). |
| `category` | Business category, e.g. `amenity: dentist` (local business source). |
| `icpScore` | 0-100 fit score from the LLM (or the rule-based fallback). |
| `matchedPersona`, `icpReasoning`, `suggestedApproach` | The LLM's scoring explanation and outreach suggestion. |
| `sourceUrl`, `scrapedAt`, `actorVersion` | Provenance. |

CSV output flattens `socialLinks` into `facebook` / `twitter` / `instagram` columns. Exported leads are sorted highest-score-first.

Alongside the leads, the run writes a **`SUMMARY`** record to the Key-Value Store — a machine-readable object with the resolved search params, per-source lead counts, totals, the hot/warm/cold breakdown, and whether LLM scoring/external actors were used. Handy for dashboards or chaining runs.

> Scoring is **batched** (~10 leads per Groq call), so scoring 50 leads takes a couple of seconds rather than a minute of one-at-a-time calls.

---

## Setup

### Groq API key
Get one at [console.groq.com/keys](https://console.groq.com/keys), paste it into `groqApiKey`. Without it, leads are still scored, just with a much cruder rule-based heuristic instead of an LLM.

### Local business source (OpenStreetMap)
No setup, no API key, no proxy, no extra cost — it queries OpenStreetMap's Nominatim search API over plain HTTP (geocode the location, then a viewbox-bounded search per term). Just supply a `location` and either `searchQueries` or an ICP the terms can be derived from. Works on any Apify plan, and a typical city search returns ~40 businesses per term in a couple of seconds.

Two tips for best coverage:
- Use short **category** terms (`dentist`, `car rental`, `restaurant`) rather than marketing phrases (`dental clinic`, `car rental company`) — Nominatim matches the category term far better. The ICP auto-derivation already produces these.
- OpenStreetMap has no ratings/reviews, and phone/website are present only where the community filled them in (usually a minority of records). The website-enrichment step backfills emails/phones/socials for the businesses that do list a website.

> Note: this uses the public Nominatim service, which asks callers to stay at ≤1 request/second (the actor throttles itself accordingly). Large targets grid-search the area, so they make more requests and take longer — a `maxResultsPerSource` of ~1000 is roughly a 5×5 grid (~25 throttled requests, ~30s) per term, so **raise the Actor's Run timeout** (e.g. 1800s) for big targets. The cross-run cache means you only pay that cost once per `(term + location)`. For very high sustained volume, consider self-hosting a Nominatim instance and pointing the actor at it.

### Scale & caching
- `maxResultsPerSource` is your target per search term. Small (50–100) runs finish in seconds; large (1000+) runs grid-search and take a few minutes — bump the Run timeout.
- Results are cached across runs in a named Key-Value Store (`LEAD-CACHE`) keyed by `(source + term + location + target)`. Re-running the same query returns instantly from storage. Set `useCache: false` to force a fresh scrape, or `cacheMaxAgeDays` to control freshness.
- `maxEnrichWebsites` caps how many lead sites are visited for contact data, so enrichment can't blow the timeout on huge result sets — leads beyond the cap keep whatever contact info OSM already had.

### Using external Apify Actors (paid)
Set `useApifyActors: true` to pull richer data from proven specialist Actors instead of the built-in crawlers:
- **Local business** → `mapsActorId` (default `compass/crawler-google-places`) — real Google Maps data incl. ratings/reviews.
- **LinkedIn** → `linkedinActorId` (default `harvestapi/linkedin-profile-search`) — real LinkedIn profiles, no cookies needed.
- **Directory** → `directoryActorId` (optional; empty = built-in crawler).

**How the fallback works:** for each of those three sources, the actor tries the external Actor first; if it can't run (or returns nothing), it automatically falls back to the built-in crawler for that source. So enabling this never *breaks* a run — worst case you get the same built-in results.

**Two hard requirements**, both confirmed the hard way in testing:
1. **Your Apify plan must permit running public Actors.** Free/restricted plans return *"your plan does not support running public Actors"* — in that case every external call fails and the actor silently falls back to the built-in crawlers. Enabling the flag on such a plan gains you nothing.
2. **External Actors bill you separately** (typically ~$0.003–0.01 per result) on top of this actor's own usage.

The Google Maps mapping is written against `compass/crawler-google-places`'s documented output. The LinkedIn/directory mappings probe several common field names defensively, since those Actors' output shapes vary — if you point them at a non-default Actor and some fields come back empty, that mapping may need a tweak.

### Proxy
Uses Apify Proxy (RESIDENTIAL group) by default, falling back to standard datacenter proxy if your account doesn't have residential access, for the LinkedIn/directory/web-search sources and website enrichment (all plain HTTP via Cheerio).

Confirmed in testing: DuckDuckGo's HTML endpoint (used for the LinkedIn and web-search sources) resets the TLS connection consistently — across multiple retries with different rotated proxy sessions — suggesting DuckDuckGo blocks Apify's residential proxy IP range at the network level, not simple rate-limiting. These two sources already throttle their own requests and run at `maxConcurrency: 1`, but expect them to fail gracefully (0 leads, no crash) rather than reliably return results until/unless that changes.

---

## Limitations

- **Local business source uses OpenStreetMap, not Google Maps.** Google Maps was tried first and abandoned for two independently-fatal reasons found in production testing: (1) scraping it directly needs residential proxies — Google silently tarpitted every navigation through datacenter/shared IPs (consistent ~45s hang, every run, even a screenshot timed out); and (2) delegating to the specialist `compass/crawler-google-places` Actor requires an Apify plan that permits running public Actors, which lower/free tiers don't. OpenStreetMap sidesteps both: it's an open dataset with a public search API that costs nothing. The tradeoff is **coverage and richness** — OSM has fewer businesses than Google Maps (especially outside well-mapped urban areas), and **no ratings or reviews**. It uses OSM's Nominatim search (a viewbox-bounded search per term); an earlier version used the Overpass API for category lookups, but Overpass was abandoned because from Apify's datacenter network every Overpass mirror consistently timed out or was throttled (four mirrors × 25s each blew the run timeout), whereas Nominatim is fast and reliable from Apify. Website coverage in OSM is patchy, but the website-enrichment step fills in emails/phones/socials for the businesses that do list a site.
- **LinkedIn**: this actor does **not** log into LinkedIn or use session cookies — that requires handing over a real account, which risks that account being banned and carries real ToS/legal exposure (see *hiQ Labs v. LinkedIn* and LinkedIn's active anti-scraping enforcement). Instead it discovers public profiles indexed by search engines (DuckDuckGo) and parses name/title/company straight out of the search snippet — that snippet data is the main payload. The optional public-profile-page fetch (`fetchLinkedInPublicProfiles`) is a bonus-only layer: in testing, LinkedIn returns an immediate bot-block response (HTTP 999) to anonymous, cookie-less requests essentially every time, proxy or not, so treat any extra fields it adds as a bonus, not something to rely on. This is a deliberate trade-off — real coverage in exchange for zero risk to a LinkedIn account.
- **Email guesses** are pattern-based heuristics confirmed only by a DNS MX lookup (does the domain receive mail at all) — not a real SMTP/deliverability check. Treat `emailStatus: "guessed"` accordingly.
- **Directories/web search** rely on plain HTTP + HTML parsing (no JS execution). Confirmed in testing: **Yell.com sits behind Cloudflare and returns HTTP 403 to plain requests** — the built-in auto-generated Yell query (used only when you don't supply `directoryUrls`) will typically yield zero results out of the box for that reason, not a bug in the parsing logic. For real directory coverage, supply `directoryUrls` pointing at directories that don't challenge plain HTTP clients (many smaller/regional directories don't), or lean on the local business / web-search sources instead, which don't have this problem.

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
| `Local business: 0 businesses` | The `location` couldn't be geocoded, or OpenStreetMap has no matching businesses in that area | Use a clearer `location` (e.g. "London, UK" not just "London"); try a broader/more common `searchQueries` term; OSM coverage is thinner outside major cities. |
| `Local business source needs a location` | `searchQueries` given but `location` empty | Set `location` — the OSM source needs it to bound the search area. |
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
