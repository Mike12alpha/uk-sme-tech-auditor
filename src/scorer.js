/**
 * Scores a scraped lead against the user's free-text ICP description using
 * Groq's hosted LLM API. Falls back to a simple rule-based heuristic if no
 * API key is configured, or if the Groq call fails.
 */

import Groq from 'groq-sdk';
import { LLM_SCORER_SYSTEM_PROMPT } from './constants.js';
import { retryAsync } from './utils.js';

let client = null;
let model = 'llama-3.3-70b-versatile';

export function initScorer({ apiKey, model: modelOverride } = {}) {
    client = apiKey ? new Groq({ apiKey }) : null;
    if (modelOverride) model = modelOverride;
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
