/**
 * Cross-source dedupe and merge.
 *
 * 1. Company-type leads (Maps/directory/web-search) that share a domain
 *    (or, lacking one, a normalized company name) are merged into one
 *    record, keeping the richest non-empty field from each.
 * 2. Person-type leads (LinkedIn) whose parsed company name matches a
 *    merged company record are attached to it (so a lead reads as
 *    "Company X — Jane Doe, Owner" instead of two disconnected records).
 *    Persons with no matching company stay as standalone person leads.
 */

function normalizeCompanyName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[.,]/g, '')
        .replace(/\b(ltd|limited|inc|llc|plc|corp|corporation|group|co)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function mergeInto(target, source) {
    for (const key of Object.keys(source)) {
        if (key === 'socialLinks') {
            target.socialLinks = { ...source.socialLinks, ...target.socialLinks };
            continue;
        }
        if ((target[key] === null || target[key] === undefined || target[key] === '') && source[key]) {
            target[key] = source[key];
        }
    }
}

export function dedupeAndMergeLeads(leads) {
    const companyLeads = leads.filter((l) => l.type === 'company');
    const personLeads = leads.filter((l) => l.type !== 'company');

    const companyByKey = new Map();
    const mergedCompanies = [];
    for (const lead of companyLeads) {
        const key = lead.domain || normalizeCompanyName(lead.companyName) || lead.leadId;
        if (companyByKey.has(key)) {
            mergeInto(companyByKey.get(key), lead);
        } else {
            companyByKey.set(key, lead);
            mergedCompanies.push(lead);
        }
    }

    const unattachedPersons = [];
    for (const person of personLeads) {
        const personCompanyKey = normalizeCompanyName(person.companyName);
        const match = personCompanyKey
            ? mergedCompanies.find((c) => !c.personName && normalizeCompanyName(c.companyName) === personCompanyKey)
            : null;

        if (match) {
            match.personName = match.personName || person.personName;
            match.jobTitle = match.jobTitle || person.jobTitle;
            match.linkedinUrl = match.linkedinUrl || person.linkedinUrl;
        } else {
            unattachedPersons.push(person);
        }
    }

    return [...mergedCompanies, ...unattachedPersons];
}
