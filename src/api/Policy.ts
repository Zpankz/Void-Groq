/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const POLICY_SITES = ["grok", "claude", "chatgpt", "perplexity", "gemini", "notebooklm"] as const;

export type PolicySite = typeof POLICY_SITES[number];
export type AuthorityClass = "cosmetic-write" | "observe-only";
export type PolicyCapability = "feature-override";
export type WriteDecisionReason = "allowed" | "forbidden" | "observe-only" | "unknown";

export interface WriteRequest {
    site: PolicySite;
    capability: PolicyCapability;
    key: string;
}

export interface WriteDecision {
    allowed: boolean;
    authority: AuthorityClass;
    reason: WriteDecisionReason;
}

export interface ForbiddenWriteRule {
    category: "employee" | "paywall" | "safety" | "org-admin" | "consent" | "payment";
    pattern: RegExp;
}

export interface ReviewedWrite extends WriteRequest {
    authority: "cosmetic-write";
    rationale: string;
}

export const COSMETIC_ONLY_DISCLAIMER = "Void applies cosmetic client-side changes and does not change server entitlements.";

export const FORBIDDEN_WRITE_RULES: readonly ForbiddenWriteRule[] = [
    { category: "employee", pattern: /(^|[_-])(employee|staff|internal)([_-]|$)/i },
    { category: "paywall", pattern: /(paywall|subscription|entitlement|premium|upgrade|upsell|server_is_(pro|max|student))/i },
    { category: "safety", pattern: /(self_harm|safety|moderation|abuse)/i },
    { category: "org-admin", pattern: /((org|organization|enterprise|role)[_-]?admin|blocked_by_org_admin)/i },
    { category: "consent", pattern: /(consent|permission|sensitive_mcp|protected_health|hipaa|pii|\bphi\b)/i },
    { category: "payment", pattern: /(payment|billing|checkout|purchase|stripe|paypal|refund)/i },
];

export const FORBIDDEN_WRITE_KEYS = new Set([
    "current_user_access",
    "disable_self_harm_short_circuit",
    "internal_employee_bypass_plan_entitlements",
    "is_x_employee",
    "is_xai_employee",
    "permissions-platform-shadow-mode",
    "product-entitlements-shadow-mode",
]);

const AUTHORITY: Record<PolicySite, AuthorityClass> = {
    grok: "cosmetic-write",
    claude: "cosmetic-write",
    chatgpt: "cosmetic-write",
    perplexity: "cosmetic-write",
    gemini: "observe-only",
    notebooklm: "observe-only",
};

export const REVIEWED_WRITES: readonly ReviewedWrite[] = [
    {
        site: "grok",
        capability: "feature-override",
        key: "workspace_agent",
        authority: "cosmetic-write",
        rationale: "Preserves the user's tested client-local baseline without asserting server access.",
    },
];

export function evaluateWrite(request: WriteRequest): WriteDecision {
    const authority = AUTHORITY[request.site];
    if (authority === "observe-only") return { allowed: false, authority, reason: "observe-only" };
    if (FORBIDDEN_WRITE_KEYS.has(request.key) || FORBIDDEN_WRITE_RULES.some(rule => rule.pattern.test(request.key))) {
        return { allowed: false, authority, reason: "forbidden" };
    }
    if (REVIEWED_WRITES.some(write => write.site === request.site && write.capability === request.capability && write.key === request.key)) {
        return { allowed: true, authority, reason: "allowed" };
    }
    return { allowed: false, authority, reason: "unknown" };
}

export function validatePreset(site: PolicySite, capability: PolicyCapability, members: readonly string[]) {
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const member of members) {
        if (!member || seen.has(member) || !evaluateWrite({ site, capability, key: member }).allowed) rejected.push(member);
        seen.add(member);
    }
    return { valid: !!members.length && !rejected.length, rejected };
}
