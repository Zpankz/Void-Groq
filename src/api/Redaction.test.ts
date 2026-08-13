/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { persistRedacted, REDACTED,redactText, redactValue } from "./Redaction";

const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";

describe("redactValue", () => {
    test("redacts nested sensitive fields while retaining useful structure", () => {
        const result = redactValue({
            build: "2026.08.13",
            user: { email: "person@example.test", profile: { name: "Tester" }, sessions: [{ jwt: fakeJwt, status: "active" }] },
            headers: { Authorization: "Bearer fake-secret", Cookie: "sid=fake" },
            api_key: "fake-key",
            session_token: "fake-session",
        });
        expect(result.value).toEqual({
            build: "2026.08.13",
            user: { email: REDACTED, profile: { name: "Tester" }, sessions: [{ jwt: REDACTED, status: "active" }] },
            headers: { Authorization: REDACTED, Cookie: REDACTED },
            api_key: REDACTED,
            session_token: REDACTED,
        });
        expect(result.log).toEqual([
            { category: "email", path: "user.email", count: 1 },
            { category: "jwt", path: "user.sessions[0].jwt", count: 1 },
            { category: "authorization", path: "headers.Authorization", count: 1 },
            { category: "cookie", path: "headers.Cookie", count: 1 },
            { category: "api-key", path: "api_key", count: 1 },
            { category: "session", path: "session_token", count: 1 },
        ]);
        expect(JSON.stringify(result.log)).not.toContain("fake");
    });

    test("sanitizes absolute, relative, and routed URL secrets without rewriting safe fragments", () => {
        const result = redactValue({
            callback: "https://example.test/callback?code=fake-code&state=fake-state&view=compact#access_token=fake-token&tab=one",
            relative: "/callback?code=fake-code#tab=one",
            routed: "/#/conversation/123?access_token=fake-token&tab=one",
            safe: "/#/conversation/123",
            hashOnly: "#access_token=fake-token&tab=one",
            safeHash: "#/conversation/123",
        });
        expect(result.value).toEqual({
            callback: "https://example.test/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D&view=compact#access_token=%5BREDACTED%5D&tab=one",
            relative: "/callback?code=%5BREDACTED%5D#tab=one",
            routed: "/#/conversation/123?access_token=%5BREDACTED%5D&tab=one",
            safe: "/#/conversation/123",
            hashOnly: "#access_token=%5BREDACTED%5D&tab=one",
            safeHash: "#/conversation/123",
        });
        expect(result.log).toEqual([
            { category: "url-secret", path: "callback.query.code", count: 1 },
            { category: "url-secret", path: "callback.query.state", count: 1 },
            { category: "url-secret", path: "callback.hash.access_token", count: 1 },
            { category: "url-secret", path: "relative.query.code", count: 1 },
            { category: "url-secret", path: "routed.hash.access_token", count: 1 },
            { category: "url-secret", path: "hashOnly.hash.access_token", count: 1 },
        ]);
    });
});

describe("redactText", () => {
    test("redacts emails, bearer tokens, JWTs, and cookie values", () => {
        const result = redactText(`email=person@example.test Authorization: Bearer fake-secret jwt=${fakeJwt} Cookie: sid=fake`);
        expect(result.value).not.toContain("person@example.test");
        expect(result.value).not.toContain("fake-secret");
        expect(result.value).not.toContain(fakeJwt);
        expect(result.value).not.toContain("sid=fake");
        expect(result.log.map(entry => entry.category)).toEqual(["authorization", "cookie", "jwt", "email"]);
    });
});

test("redacts before invoking persistence", async () => {
    const write = mock((value: unknown) => Promise.resolve(value));
    await persistRedacted({ token: "fake-token", safe: 42 }, write);
    expect(write).toHaveBeenCalledWith({ token: REDACTED, safe: 42 });
    expect(JSON.stringify(write.mock.calls)).not.toContain("fake-token");
});
