/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { bootHostAdapter, createHostCapabilities, detectSite, type HostAdapter, resolveHostAdapter, SITE_IDS, writeHostFlag } from "./HostAdapter";

const locations = [
    ["grok.com", "grok"],
    ["www.grok.com", "grok"],
    ["claude.ai", "claude"],
    ["app.claude.ai", "claude"],
    ["chatgpt.com", "chatgpt"],
    ["www.chatgpt.com", "chatgpt"],
    ["perplexity.ai", "perplexity"],
    ["www.perplexity.ai", "perplexity"],
    ["gemini.google.com", "gemini"],
    ["www.gemini.google.com", "gemini"],
    ["notebooklm.google.com", "notebooklm"],
    ["www.notebooklm.google.com", "notebooklm"],
    ["notebook.google.com", "notebooklm"],
] as const;

function adapter(id: typeof SITE_IDS[number], overrides: Partial<HostAdapter> = {}): HostAdapter {
    return {
        id,
        match: location => detectSite(location) === id,
        capabilities: createHostCapabilities(),
        boot: () => {},
        ready: () => {},
        teardown: () => {},
        catalog: () => [],
        ...overrides,
    };
}

describe("detectSite", () => {
    test.each(locations)("detects %s as %s", (hostname, site) => {
        expect(detectSite({ hostname })).toBe(site);
    });

    test("normalizes case and trailing dots", () => {
        expect(detectSite({ hostname: "WWW.GROK.COM." })).toBe("grok");
    });

    test.each(["", "localhost", "x.ai", "openai.com", "google.com", "notgrok.com", "grok.com.evil.test", "evilgemini.google.com", "xn--grok-9za.com"])("rejects unknown or lookalike host %s", hostname => {
        expect(detectSite({ hostname })).toBeNull();
    });
});

describe("HostAdapter", () => {
    test("defaults every capability to unavailable", () => {
        expect(createHostCapabilities()).toEqual({
            overlay: false,
            "catalog-read": false,
            "flag-write": false,
            "router-hook": false,
            "angular-dom": false,
            turbopack: false,
        });
        expect(createHostCapabilities("overlay", "catalog-read")).toMatchObject({ overlay: true, "catalog-read": true, "flag-write": false, turbopack: false });
    });

    test("resolves exactly one matching adapter", () => {
        const grok = adapter("grok");
        expect(resolveHostAdapter({ hostname: "grok.com" }, [grok, adapter("claude")])).toBe(grok);
        expect(resolveHostAdapter({ hostname: "grok.com" }, [adapter("grok", { match: () => false })])).toBeNull();
    });

    test("does not boot host code for unknown or unmatched sites", async () => {
        const boot = mock(() => {});
        const grok = adapter("grok", { boot });
        await expect(bootHostAdapter({ hostname: "example.test" }, [grok])).resolves.toBeNull();
        await expect(bootHostAdapter({ hostname: "claude.ai" }, [grok])).resolves.toBeNull();
        expect(boot).not.toHaveBeenCalled();
        await expect(bootHostAdapter({ hostname: "grok.com" }, [grok])).resolves.toBe(grok);
        expect(boot).toHaveBeenCalledTimes(1);
    });

    test("gates optional writers through policy and declared capability", async () => {
        const write = mock(() => Promise.resolve());
        const grok = adapter("grok", { capabilities: createHostCapabilities("flag-write"), writer: { write } });
        await expect(writeHostFlag(grok, "workspace_agent", true)).resolves.toMatchObject({ allowed: true, written: true });
        await expect(writeHostFlag(grok, "is_xai_employee", true)).resolves.toMatchObject({ allowed: false, reason: "forbidden", written: false });
        await expect(writeHostFlag(adapter("grok", { capabilities: createHostCapabilities("flag-write") }), "workspace_agent", true)).resolves.toMatchObject({ allowed: false, reason: "unavailable", written: false });
        await expect(writeHostFlag(adapter("grok", { writer: { write } }), "workspace_agent", true)).resolves.toMatchObject({ allowed: false, reason: "unavailable", written: false });
        expect(write).toHaveBeenCalledTimes(1);
    });
});
