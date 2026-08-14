/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { classifyTrialRequest, createTrialFetch, TrialRequestBlockedError } from "./NetworkPolicy";

const baseUrl = "https://grok.com/";

describe("classifyTrialRequest", () => {
    test.each([
        ["GET", "/api/bootstrap", "passive-read"],
        ["HEAD", "/assets/app.js", "passive-read"],
        ["OPTIONS", "/api/connectors", "passive-read"],
        ["POST", "/api/log_metric", "telemetry"],
        ["GET", "/backend-api/conversations", "passive-read"],
        ["GET", "/assets/chat-stream-planner.js", "passive-read"],
        ["GET", "/share", "passive-read"],
        ["GET", "/auth/callback?state=secret", "passive-read"],
        ["GET", "/oauth/apple/callback", "passive-read"],
        ["GET", "/auth/callback?application=web", "passive-read"],
        ["GET", "/oauth/authorize?app_id=1", "passive-read"],
    ] as const)("allows %s %s", (method, url, category) => {
        expect(classifyTrialRequest({ site: "grok", method, url, baseUrl })).toMatchObject({ blocked: false, category });
    });

    test.each([
        ["POST", "/backend-api/conversation", "completion"],
        ["POST", "/api/subscription/cancel", "billing"],
        ["POST", "https://api.stripe.com/v1/checkout/sessions", "checkout"],
        ["GET", "/oauth/authorize?connector=drive&code=secret", "connector-oauth"],
        ["GET", "/api/connectors/oauth/start", "connector-oauth"],
        ["GET", "/oauth/connectors/callback", "connector-oauth"],
        ["GET", "/plugins/oauth", "connector-oauth"],
        ["GET", "/oauth/authorize?connectors=drive", "connector-oauth"],
        ["GET", "/api/enableconnector", "connector-oauth"],
        ["POST", "/api/plugins/install", "plugin-mutation"],
        ["POST", "/api/sources/upload", "upload"],
        ["POST", "/api/share/public-link", "share"],
        ["DELETE", "/api/conversations/1", "delete"],
        ["POST", "/api/accounts/switch", "account-switch"],
        ["POST", "/api/unclassified", "unknown-mutation"],
        ["GET", "https://www.perplexity.ai/search?eppo_force_flag=1", "staff-override"],
    ] as const)("blocks %s %s", (method, url, category) => {
        expect(classifyTrialRequest({ site: "grok", method, url, baseUrl })).toMatchObject({ blocked: true, category });
    });

    test("allows telemetry regardless of payload text", () => {
        expect(classifyTrialRequest({ site: "grok", method: "POST", url: "/api/log_metric", baseUrl, body: JSON.stringify({ message: "conversation prompt plan share" }) })).toMatchObject({ blocked: false, category: "telemetry" });
    });

    test("classifies method and request body keys without retaining values", () => {
        const result = classifyTrialRequest({
            site: "chatgpt",
            method: "POST",
            url: "/api/graphql?state=oauth-secret",
            baseUrl: "https://chatgpt.com/",
            headers: { authorization: "Bearer secret", "content-type": "application/json" },
            body: JSON.stringify({ query: "mutation EnableConnector { secret }", user: { email: "person@example.com", jwt: "secret" } }),
        });
        expect(result).toMatchObject({ blocked: true, category: "connector-oauth" });
        expect(result.evidence.queryNames).toEqual(["state"]);
        expect(result.evidence.bodyKeys).toEqual(["query", "user.email", "user.jwt"]);
        expect(JSON.stringify(result.evidence)).not.toContain("secret");
        expect(JSON.stringify(result.evidence)).not.toContain("person@example.com");
    });

    test.each(["gemini", "notebooklm"] as const)("blocks unknown %s mutations", site => {
        expect(classifyTrialRequest({ site, method: "POST", url: "/api/source", baseUrl: "https://notebook.google.com/" })).toMatchObject({ blocked: true });
    });
});

describe("createTrialFetch", () => {
    test("blocks before fetch, records evidence, and allows passive reads", async () => {
        const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 204 })));
        const blocked = mock(() => {});
        const trialFetch = createTrialFetch({ site: "grok", trialId: "trial-1", baseUrl, fetchImpl, onBlocked: blocked });

        await expect(trialFetch("/api/chat/completions", { method: "POST", body: "prompt=secret" })).rejects.toBeInstanceOf(TrialRequestBlockedError);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(blocked).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(blocked.mock.calls[0])).not.toContain("secret");

        await trialFetch("/api/bootstrap");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
