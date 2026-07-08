/**
 * AI scoring engine using an open-source LLM via Ollama.
 * Falls back to rule-based scoring if Ollama is unavailable.
 */

import ollama from 'ollama';
import { Actor, log } from 'apify';
import { extractDomain, retryAsync } from './utils.js';
import { LLM_SYSTEM_PROMPT, RULE_BASED_WEIGHTS, INDUSTRY_WEIGHTS } from './constants.js';

let ollamaConfig = null;
let kvStore = null;

/**
 * Initialize the scorer with Ollama config and a Key-Value Store for caching.
 * @param {Object} config
 * @param {string} config.baseUrl
 * @param {string} config.model
 */
export async function initScorer(config = {}) {
    const baseUrl = config.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = config.model || process.env.OLLAMA_MODEL || 'llama3.2';

    ollamaConfig = { baseUrl, model };
    kvStore = await Actor.openKeyValueStore();

    log.info(`Ollama scorer configured: ${model} @ ${baseUrl}`);
}

/**
 * Build a cache key for a given domain.
 * @param {string} url
 * @returns {string}
 */
function cacheKey(url) {
    return `llm-cache:${extractDomain(url)}`;
}

/**
 * Rule-based fallback scoring when the LLM is unavailable.
 * @param {Object} techData
 * @param {string} industry
 * @returns {Object}
 */
function ruleBasedScore(techData, industry) {
    const weights = INDUSTRY_WEIGHTS[industry] || INDUSTRY_WEIGHTS.automotive;
    const stack = (techData.techStack || []).map((t) => t.toLowerCase());
    let score = 20;
    const painPoints = [];

    if (stack.some((t) => t.includes('wordpress')) && (techData.lighthousePerformance ?? 100) < 50) {
        score += RULE_BASED_WEIGHTS.wordpressOld * weights.legacyCmsPenalty;
        painPoints.push('WordPress site with poor Lighthouse performance');
    }

    if (!techData.hasBookingSystem) {
        score += RULE_BASED_WEIGHTS.noBookingSystem * weights.bookingImportance;
        painPoints.push('No online booking or appointment system detected');
    }

    if (!techData.hasSsl) {
        score += RULE_BASED_WEIGHTS.sslMissing * weights.sslImportance;
        painPoints.push('SSL certificate missing or not enforced');
    }

    if (techData.hasEcommerce && (techData.lighthousePerformance ?? 100) < 50) {
        score += RULE_BASED_WEIGHTS.ecommerceSlowCheckout * weights.ecommerceImportance;
        painPoints.push('E-commerce site with slow checkout experience');
    }

    if (stack.some((t) => t.includes('jquery'))) {
        score += RULE_BASED_WEIGHTS.jQueryPresent;
        painPoints.push('Legacy jQuery still present in tech stack');
    }

    if (techData.analytics?.length === 0) {
        score += RULE_BASED_WEIGHTS.noAnalytics;
        painPoints.push('No analytics platform detected');
    }

    if ((techData.lighthousePerformance ?? 100) < 30) {
        score += RULE_BASED_WEIGHTS.mobilePerformanceLow * weights.mobileImportance;
        painPoints.push('Very poor mobile/performance score');
    }

    score = Math.min(100, Math.max(0, Math.round(score)));

    return {
        score,
        painPoints: painPoints.length ? painPoints : ['No major pain points detected'],
        reasoning: `Rule-based fallback score for ${industry} using detected tech signals.`,
        glosixPitchAngle: 'Glosix Systems can modernise your digital stack with UK-based remote developers.',
        recommendedApproach: score >= 80
            ? 'Call this week with a tailored modernisation proposal.'
            : score >= 60
                ? 'Send a case study and book a discovery call.'
                : 'Add to nurture sequence and revisit quarterly.',
    };
}

/**
 * Ask the local Ollama model to score the lead.
 * @param {Object} techData
 * @param {string} url
 * @param {string} industry
 * @param {string} companySize
 * @returns {Promise<Object>}
 */
export async function score(techData, url, industry, companySize) {
    if (!ollamaConfig) throw new Error('Scorer not initialized. Call initScorer first.');

    const domain = extractDomain(url);
    const key = cacheKey(url);

    // Check cache
    try {
        const cached = await kvStore.getValue(key);
        if (cached) {
            return cached;
        }
    } catch {
        // ignore cache read failure
    }

    const userPrompt = `Website: ${url}
Industry: ${industry}
Company size: ${companySize}
Domain: ${domain}

Audit Data:
${JSON.stringify({
        techStack: techData.techStack,
        cms: techData.cms,
        frameworks: techData.frameworks,
        analytics: techData.analytics,
        ecommerce: techData.ecommerce,
        lighthousePerformance: techData.lighthousePerformance,
        lighthouseSeo: techData.lighthouseSeo,
        lighthouseBestPractices: techData.lighthouseBestPractices,
        hasSsl: techData.hasSsl,
        hasBookingSystem: techData.hasBookingSystem,
        hasEcommerce: techData.hasEcommerce,
        hasContactForm: techData.hasContactForm,
        pageLoadTime: techData.pageLoadTime,
        mobileResponsive: techData.mobileResponsive,
    }, null, 2)}

Return only valid JSON.`;

    try {
        const response = await retryAsync(async () => {
            return ollama.chat({
                model: ollamaConfig.model,
                messages: [
                    { role: 'system', content: LLM_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                format: 'json',
                options: {
                    temperature: 0.2,
                    num_predict: 700,
                },
                host: ollamaConfig.baseUrl,
            });
        }, 2);

        const raw = response?.message?.content || '{}';
        const parsed = JSON.parse(raw);

        const result = {
            score: Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0))),
            painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
            reasoning: String(parsed.reasoning || ''),
            glosixPitchAngle: String(parsed.glosixPitchAngle || ''),
            recommendedApproach: String(parsed.recommendedApproach || ''),
        };

        // Cache successful result
        try {
            await kvStore.setValue(key, result);
        } catch {
            // ignore cache write failure
        }

        return result;
    } catch (err) {
        log.warning(`Ollama scoring failed for ${url}, using rule-based fallback: ${err.message}`);
        return ruleBasedScore(techData, industry);
    }
}

export { ruleBasedScore };
