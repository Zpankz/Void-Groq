/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { createHostCapabilities } from "./HostAdapter";
import { evaluatePluginAvailability, runWhenPluginAvailable } from "./PluginCatalog";

const grok = createHostCapabilities("overlay", "catalog-read", "flag-write", "router-hook", "turbopack");
const overlay = createHostCapabilities("overlay");

describe("plugin availability", () => {
    test("allows a portable plugin with its required capability", () => {
        const plugin = { name: "Portable", sites: ["grok", "claude"] as const, capabilities: ["overlay"] as const };
        expect(evaluatePluginAvailability(plugin, "claude", overlay)).toEqual({ available: true });
    });

    test("defaults an unaudited plugin to Grok only", () => {
        const plugin = { name: "Legacy" };
        expect(evaluatePluginAvailability(plugin, "grok", grok)).toEqual({ available: true });
        expect(evaluatePluginAvailability(plugin, "gemini", overlay)).toEqual({ available: false, reason: "site", supportedSites: ["grok"] });
    });

    test("rejects a plugin when a host capability is unavailable", () => {
        const plugin = { name: "Patched", sites: ["claude"] as const, capabilities: ["turbopack"] as const };
        expect(evaluatePluginAvailability(plugin, "claude", overlay)).toEqual({ available: false, reason: "capability", missingCapabilities: ["turbopack"] });
    });

    test("fails closed before executing any side effect", () => {
        const effect = mock(() => true);
        const plugin = { name: "Required", required: true, sites: ["gemini"] as const, capabilities: ["flag-write"] as const };
        expect(runWhenPluginAvailable(plugin, { Required: plugin }, "gemini", overlay, effect)).toBeUndefined();
        expect(effect).not.toHaveBeenCalled();
    });

    test("blocks a portable plugin whose dependency is Grok-only", () => {
        const effect = mock(() => true);
        const child = { name: "GrokChild" };
        const parent = { name: "PortableParent", sites: ["claude"] as const, capabilities: ["overlay"] as const, dependencies: ["GrokChild"] };
        const catalog = { PortableParent: parent, GrokChild: child };
        expect(runWhenPluginAvailable(parent, catalog, "claude", overlay, effect)).toBeUndefined();
        expect(effect).not.toHaveBeenCalled();
    });

    test("runs only after the complete dependency tree is available", () => {
        const effect = mock(() => "started");
        const child = { name: "GrokChild" };
        const parent = { name: "PortableParent", sites: ["grok", "claude"] as const, dependencies: ["GrokChild"] };
        expect(runWhenPluginAvailable(parent, { PortableParent: parent, GrokChild: child }, "grok", grok, effect)).toBe("started");
        expect(effect).toHaveBeenCalledTimes(1);
    });
});
