/**
 * Scores a scraped lead against the user's free-text ICP description using
 * Groq's hosted LLM API. Falls back to a simple rule-based heuristic if no
 * API key is configured, or if the Groq call fails.
 */

import Groq from 'groq-sdk';
import { LLM_SCORER_SYSTEM_PROMPT, ICP_PARSER_SYSTEM_PROMPT } from './constants.js';
import { retryAsync } from './utils.js';

let client = null;
let model = 'llama-3.3-70b-versatile';

export function initScorer({ apiKey, model: modelOverride } = {}) {
    client = apiKey ? new Groq({ apiKey }) : null;
    if (modelOverride) model = modelOverride;
}

export function isLlmScoringEnabled() {
    return !!client;
}

/**
 * Uses the LLM to derive structured search parameters (business-type search
 * terms, location, country code, persona job titles) from the user's
 * free-text ICP, so they only have to describe who they want in plain
 * English. Returns null if no LLM is configured or the call fails, in which
 * case the caller keeps whatever explicit fields the user provided.
 */
export async function deriveSearchParamsFromIcp(icpDescription) {
    if (!client) return null;
    try {
        const result = await retryAsync(async () => {
            const response = await client.chat.completions.create({
                model,
                max_tokens: 300,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: ICP_PARSER_SYSTEM_PROMPT },
                    { role: 'user', content: icpDescription },
                ],
            });
            const text = response.choices?.[0]?.message?.content;
            if (!text) throw new Error('No content in Groq response');
            return JSON.parse(text);
        }, 2, 800);

        const cleanArr = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
        return {
            searchQueries: cleanArr(result.searchQueries),
            location: result.location ? String(result.location).trim() : '',
            countryCode: result.countryCode ? String(result.countryCode).trim().toUpperCase() : '',
            personaTitles: cleanArr(result.personaTitles),
        };
    } catch {
        return null;
    }
}

function ruleBasedScore(lead, icpDescription) {
    let score = 30;
    const icp = (icpDescription || '').toLowerCase();
    if (lead.email) score += 15;
    if (lead.phone) score += 10;
    if (lead.website) score += 10;
    if (lead.jobTitle && icp.includes(lead.jobTitle.toLowerCase())) score += 20;
    if (lead.category && icp.includes(lead.category.toLowerCase())) score += 15;
    score = Math.max(0, Math.min(100, score));

    return {
        score,
        matchedPersona: score >= 60,
        reasoning: 'Rule-based fallback score (no AI scoring available): based on data completeness and keyword overlap with the ICP description.',
        suggestedApproach: lead.email ? 'Reach out directly via the email on file.' : 'Find a direct contact before outreach.',
    };
}

function buildLeadSummary(lead) {
    return {
        type: lead.type,
        companyName: lead.companyName,
        personName: lead.personName,
        jobTitle: lead.jobTitle,
        category: lead.category,
        website: lead.website,
        city: lead.city,
        country: lead.country,
        rating: lead.rating,
        reviewsCount: lead.reviewsCount,
        hasEmail: !!lead.email,
        hasPhone: !!lead.phone,
        source: lead.source,
    };
}

export async function scoreLead(lead, icpDescription) {
    if (!client) return ruleBasedScore(lead, icpDescription);

    try {
        const result = await retryAsync(async () => {
            const response = await client.chat.completions.create({
                model,
                max_tokens: 400,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: LLM_SCORER_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `ICP:\n${icpDescription}\n\nLead:\n${JSON.stringify(buildLeadSummary(lead), null, 2)}`,
                    },
                ],
            });
            const text = response.choices?.[0]?.message?.content;
            if (!text) throw new Error('No content in Groq response');
            return JSON.parse(text);
        }, 2, 800);

        return {
            score: Math.max(0, Math.min(100, Number(result.score) || 0)),
            matchedPersona: !!result.matchedPersona,
            reasoning: result.reasoning || '',
            suggestedApproach: result.suggestedApproach || '',
        };
    } catch (err) {
        return {
            ...ruleBasedScore(lead, icpDescription),
            reasoning: `AI scoring failed (${err.message}); used rule-based fallback.`,
        };
    }
}
