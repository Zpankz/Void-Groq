/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { type BlockedRequestEvidence, classifyTrialRequest, createTrialFetch, TrialRequestBlockedError } from "./NetworkPolicy";

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
        ["POST", "/api/stripe/checkout/sessions", "checkout"],
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
        ["GET", "/search?eppo_force_flag=1", "staff-override"],
    ] as const)("blocks %s %s", (method, url, category) => {
        expect(classifyTrialRequest({ site: "grok", method, url, baseUrl })).toMatchObject({ blocked: true, category });
    });

    test("allows telemetry regardless of payload text", () => {
        expect(classifyTrialRequest({ site: "grok", method: "POST", url: "/api/log_metric", baseUrl, body: JSON.stringify({ message: "conversation prompt plan share" }) })).toMatchObject({ blocked: false, category: "telemetry" });
    });

    test.each([
        ["relative string", "/api/bootstrap"],
        ["absolute string", "https://grok.com/api/bootstrap"],
        ["URL", new URL("/api/bootstrap", baseUrl)],
        ["Request", new Request("https://grok.com/api/bootstrap")],
    ])("allows same-origin %s input", (_, url) => {
        expect(classifyTrialRequest({ site: "grok", url, baseUrl })).toMatchObject({ blocked: false, category: "passive-read" });
    });

    test.each([
        ["passive GET", "GET", "https://example.test/api/bootstrap"],
        ["telemetry POST", "POST", "https://example.test/api/log_metric"],
        ["URL", "GET", new URL("https://example.test/api/bootstrap")],
        ["Request", undefined, new Request("https://example.test/api/bootstrap")],
    ])("blocks cross-origin %s before category allowance", (_, method, url) => {
        expect(classifyTrialRequest({ site: "grok", method, url, baseUrl })).toMatchObject({ blocked: true, category: "untrusted-origin" });
    });

    test.each([
        ["wrong scheme", "http://grok.com/api/bootstrap", baseUrl],
        ["wrong port", "https://grok.com:444/api/bootstrap", baseUrl],
        ["suffix host", "https://grok.com.evil.test/api/bootstrap", baseUrl],
        ["prefix host", "https://notgrok.com/api/bootstrap", baseUrl],
        ["Unicode confusable host", "https://grók.com/api/bootstrap", baseUrl],
        ["embedded credentials", "https://user:password@grok.com/api/bootstrap", baseUrl],
        ["mismatched declared site", "/api/bootstrap", "https://claude.ai/"],
        ["untrusted base scheme", "/api/bootstrap", "http://grok.com/"],
        ["untrusted base port", "/api/bootstrap", "https://grok.com:444/"],
        ["invalid base", "https://grok.com/api/bootstrap", "not a URL"],
    ])("fails closed for %s", (_, url, trustedBase) => {
        expect(classifyTrialRequest({ site: "grok", url, baseUrl: trustedBase })).toMatchObject({ blocked: true, category: "untrusted-origin" });
    });

    test.each([
        ["claude", "https://claude.ai/"],
        ["chatgpt", "https://chatgpt.com/"],
        ["perplexity", "https://www.perplexity.ai/"],
        ["gemini", "https://gemini.google.com/"],
        ["notebooklm", "https://notebooklm.google.com/"],
        ["notebooklm", "https://notebook.google.com/"],
    ] as const)("accepts the declared %s site base", (site, trustedBase) => {
        expect(classifyTrialRequest({ site, url: "/api/bootstrap", baseUrl: trustedBase })).toMatchObject({ blocked: false, category: "passive-read" });
    });

    test("counts the serialized UTF-8 bytes of URLSearchParams bodies", () => {
        const body = new URLSearchParams({ emoji: "☃", phrase: "two words" });
        expect(classifyTrialRequest({ site: "grok", method: "POST", url: "/api/unclassified", baseUrl, body }).evidence.bodyBytes).toBe(new TextEncoder().encode(body.toString()).byteLength);
    });

    test("does not retain opaque body values as evidence keys", () => {
        const result = classifyTrialRequest({ site: "grok", method: "POST", url: "/api/unclassified", baseUrl, body: "opaque-body-secret" });
        expect(result.evidence.bodyKeys).toEqual([]);
        expect(JSON.stringify(result.evidence)).not.toContain("opaque-body-secret");
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
    test("blocks before fetch, records value-free evidence, and allows passive reads", async () => {
        const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 204 })));
        const blocked = mock((_evidence: BlockedRequestEvidence) => {});
        const trialFetch = createTrialFetch({ site: "grok", trialId: "trial-1", baseUrl, fetchImpl, onBlocked: blocked });

        await expect(trialFetch("/api/person%40example.test/chat/completions?state=query-secret", { method: "POST", headers: { authorization: "Bearer header-secret" }, body: "prompt=body-secret" })).rejects.toBeInstanceOf(TrialRequestBlockedError);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(blocked).toHaveBeenCalledTimes(1);
        expect(blocked.mock.calls[0][0].path).toBe("/:segment/:segment/:segment/:segment");
        expect(JSON.stringify(blocked.mock.calls[0])).not.toContain("person@example.test");
        expect(JSON.stringify(blocked.mock.calls[0])).not.toContain("query-secret");
        expect(JSON.stringify(blocked.mock.calls[0])).not.toContain("header-secret");
        expect(JSON.stringify(blocked.mock.calls[0])).not.toContain("body-secret");

        await trialFetch("/api/bootstrap");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["passive GET", "https://example.test/api/bootstrap", undefined],
        ["telemetry POST", "https://example.test/api/log_metric", { method: "POST" }],
        ["URL", new URL("https://example.test/api/bootstrap"), undefined],
        ["Request", new Request("https://example.test/api/bootstrap"), undefined],
    ])("blocks cross-origin %s before fetch", async (_, input, init) => {
        const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 204 })));
        const blocked = mock((_evidence: unknown) => {});
        const trialFetch = createTrialFetch({ site: "grok", trialId: "trial-1", baseUrl, fetchImpl, onBlocked: blocked });

        await expect(trialFetch(input, init)).rejects.toBeInstanceOf(TrialRequestBlockedError);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(blocked).toHaveBeenCalledTimes(1);
        expect(blocked.mock.calls[0][0]).toMatchObject({ category: "untrusted-origin", blocked: true });
    });

    test("prevents redirect escape at the fetch layer", async () => {
        const fetchImpl = mock((_input: string | URL | Request, init?: RequestInit) => init?.redirect === "error"
            ? Promise.reject(new TypeError("Redirect blocked"))
            : Promise.resolve(new Response(null, { status: 302, headers: { location: "https://example.test/collect?token=redirect-secret" } })));
        const blocked = mock(() => {});
        const trialFetch = createTrialFetch({ site: "grok", trialId: "trial-1", baseUrl, fetchImpl, onBlocked: blocked });

        await expect(trialFetch("/api/bootstrap", { redirect: "follow" })).rejects.toBeInstanceOf(TypeError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "error" });
        expect(blocked).not.toHaveBeenCalled();
    });
});
