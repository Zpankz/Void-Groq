/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import {
    COSMETIC_ONLY_DISCLAIMER,
    evaluateWrite,
    FORBIDDEN_WRITE_RULES,
    POLICY_SITES,
    type PolicySite,
    REVIEWED_WRITES,
    validatePreset,
} from "./Policy";

const capability = "feature-override" as const;
const request = (site: PolicySite, key: string) => ({ site, capability, key });

describe("evaluateWrite", () => {
    test.each([
        ["grok", "is_xai_employee", "employee"],
        ["grok", "xai-staff-mode", "employee"],
        ["grok", "enable_imagine_paywall", "paywall"],
        ["perplexity", "server_is_max", "paywall"],
        ["grok", "disable_self_harm_short_circuit", "safety"],
        ["claude", "enterprise_admin_override", "org-admin"],
        ["claude", "sensitive_mcps_per_call_consent", "consent"],
        ["claude", "hipaa_connector_permission", "consent"],
        ["chatgpt", "force_payment_method", "payment"],
        ["chatgpt", "purchase_premium", "paywall"],
    ] as const)("blocks %s write %s as %s", (site, key) => {
        expect(evaluateWrite(request(site, key))).toMatchObject({ allowed: false, authority: "cosmetic-write", reason: "forbidden" });
    });

    test.each(["grok", "claude", "chatgpt", "perplexity"] as const)("fails closed for an unknown %s write", site => {
        expect(evaluateWrite(request(site, "unreviewed_cosmetic_flag"))).toEqual({ allowed: false, authority: "cosmetic-write", reason: "unknown" });
    });

    test.each(["gemini", "notebooklm"] as const)("blocks every %s write as observe-only", site => {
        for (const key of ["workspace_agent", "is_xai_employee", "any_flag"]) {
            expect(evaluateWrite(request(site, key))).toEqual({ allowed: false, authority: "observe-only", reason: "observe-only" });
        }
    });

    test("allows only the reviewed site, capability, and key combination", () => {
        expect(evaluateWrite(request("grok", "workspace_agent"))).toEqual({ allowed: true, authority: "cosmetic-write", reason: "allowed" });
        expect(evaluateWrite(request("claude", "workspace_agent"))).toMatchObject({ allowed: false, reason: "unknown" });
    });

    test("defines authority for every policy site", () => {
        for (const site of POLICY_SITES) expect(evaluateWrite(request(site, "unknown"))).toHaveProperty("authority");
    });

    test("uses only stateless deny patterns", () => {
        for (const { pattern } of FORBIDDEN_WRITE_RULES) expect(pattern.global || pattern.sticky).toBe(false);
    });

    test("does not allow a reviewed key that becomes forbidden", () => {
        const reviewed = REVIEWED_WRITES[0];
        expect(evaluateWrite({ ...reviewed, key: `employee_${reviewed.key}` })).toMatchObject({ allowed: false, reason: "forbidden" });
    });
});

describe("validatePreset", () => {
    test("rejects forbidden and unknown members", () => {
        expect(validatePreset("grok", capability, ["workspace_agent", "is_xai_employee", "unreviewed_flag"])).toEqual({
            valid: false,
            rejected: ["is_xai_employee", "unreviewed_flag"],
        });
    });

    test("rejects empty, blank, duplicate, and observe-only presets", () => {
        expect(validatePreset("grok", capability, [])).toEqual({ valid: false, rejected: [] });
        expect(validatePreset("grok", capability, [""])).toEqual({ valid: false, rejected: [""] });
        expect(validatePreset("grok", capability, ["workspace_agent", "workspace_agent"])).toEqual({ valid: false, rejected: ["workspace_agent"] });
        expect(validatePreset("gemini", capability, ["workspace_agent"])).toEqual({ valid: false, rejected: ["workspace_agent"] });
    });

    test("accepts reviewed cosmetic members", () => {
        expect(validatePreset("grok", capability, ["workspace_agent"])).toEqual({ valid: true, rejected: [] });
    });
});

test("exports the cosmetic authority warning", () => {
    expect(COSMETIC_ONLY_DISCLAIMER).toContain("does not change server entitlements");
});
