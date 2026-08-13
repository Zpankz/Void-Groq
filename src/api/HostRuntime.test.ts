/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { SITE_IDS, type SiteId } from "./HostAdapter";
import { createHostRuntime, createPassiveHostRuntime, type HostRuntime,resolveHostRuntime } from "./HostRuntime";

function runtime(id: HostRuntime["id"], install = mock(() => {}), teardown = mock(() => {})) {
    return { value: createHostRuntime({ id, install, ready: () => Promise.resolve(true), teardown }), install, teardown };
}

describe("HostRuntime", () => {
    test("never installs the Grok runtime for non-Grok sites", async () => {
        const grok = runtime("grok-turbopack");
        for (const site of SITE_IDS.filter(site => site !== "grok")) {
            const selected = resolveHostRuntime(site, grok.value);
            expect(selected).not.toBeNull();
            await selected!.install();
            await selected!.ready();
            expect(selected!.id).not.toBe("grok-turbopack");
        }
        expect(grok.install).not.toHaveBeenCalled();
    });

    test("selects Grok exactly and rejects unknown", () => {
        const grok = runtime("grok-turbopack").value;
        expect(resolveHostRuntime("grok", grok)).toBe(grok);
        expect(resolveHostRuntime(null, grok)).toBeNull();
    });

    test("selects inert placeholder kinds without adding host behavior", () => {
        const grok = runtime("grok-turbopack").value;
        const expected: Record<Exclude<SiteId, "grok">, HostRuntime["id"]> = {
            claude: "noop",
            chatgpt: "router",
            perplexity: "noop",
            gemini: "dom",
            notebooklm: "dom",
        };
        for (const [site, id] of Object.entries(expected) as [Exclude<SiteId, "grok">, HostRuntime["id"]][]) {
            expect(resolveHostRuntime(site, grok)?.id).toBe(id);
        }
    });

    test("delegates readiness to the selected runtime", async () => {
        const events: string[] = [];
        const managed = createHostRuntime({
            id: "grok-turbopack",
            install: () => { events.push("install"); },
            ready: async () => { events.push("ready"); return true; },
            teardown: () => { events.push("teardown"); },
        });
        await managed.install();
        await managed.ready();
        expect(events).toEqual(["install", "ready"]);
    });

    test("makes teardown idempotent for installed and passive runtimes", async () => {
        const managed = runtime("grok-turbopack");
        await managed.value.install();
        await managed.value.teardown();
        await managed.value.teardown();
        expect(managed.teardown).toHaveBeenCalledTimes(1);

        const passive = createPassiveHostRuntime("dom");
        await passive.teardown();
        await passive.teardown();
    });

    test("does not reinstall a runtime", async () => {
        const managed = runtime("grok-turbopack");
        await managed.value.install();
        await managed.value.install();
        expect(managed.install).toHaveBeenCalledTimes(1);
    });
});
