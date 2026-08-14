/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { SITE_IDS } from "./HostAdapter";
import { createSettingsDocument, exportLegacySettings, migrateSettingsDocument, pruneSitePlugins, SETTINGS_SCHEMA_VERSION } from "./SettingsSchema";

const legacy = {
    plugins: {
        Settings: {
            enabled: true,
            showVoidMenu: false,
            themes: [{ url: "local", name: "Fixture", author: "Tester", description: "Fixture theme", enabled: true, local: true, css: ".fixture {}" }],
            themesEnabled: true,
            onlineThemesEnabled: false,
            customCSS: ".void { color: red; }",
            customCSSEnabled: true,
            knownPlugins: { Experiments: 1 },
            chunkFingerprint: ["fixture-hash"],
        },
        Experiments: { enabled: true, toastNotifications: false, browserNotifications: true, knownFlags: { workspace_agent: 1 } },
        RemovedPlugin: { enabled: false, privateValue: "preserve-until-pruned" },
    },
    notifications: { timeout: 9000, position: "top-right" as const },
};

describe("migrateSettingsDocument", () => {
    test("moves the current flat settings fixture losslessly into Grok", () => {
        const migrated = migrateSettingsDocument(legacy);
        expect(migrated.changed).toBeTrue();
        expect(migrated.document.version).toBe(SETTINGS_SCHEMA_VERSION);
        expect(migrated.document.global.notifications).toEqual(legacy.notifications);
        expect(migrated.document.sites.grok.plugins).toEqual(legacy.plugins);
        expect(migrated.document.sites.grok.experiments).toEqual({});
        expect(migrated.document.sites.grok.presets).toEqual({});
    });

    test("creates distinct empty site state for Gemini and NotebookLM", () => {
        const { document } = migrateSettingsDocument(legacy);
        expect(document.sites.gemini.plugins).toEqual({});
        expect(document.sites.notebooklm.plugins).toEqual({});
        document.sites.gemini.plugins.Portable = { enabled: true };
        expect(document.sites.notebooklm.plugins).toEqual({});
        expect(document.sites.grok.plugins.Portable).toBeUndefined();
    });

    test("is idempotent for the current schema", () => {
        const current = createSettingsDocument();
        current.sites.chatgpt.experiments.test = true;
        const migrated = migrateSettingsDocument(current);
        expect(migrated).toEqual({ document: current, changed: false });
    });

    test("does not import unrelated host credentials from malformed legacy roots", () => {
        const { document } = migrateSettingsDocument({ ...legacy, cookies: ["fake-cookie"], authorization: "Bearer fake" });
        expect(JSON.stringify(document)).not.toContain("fake-cookie");
        expect(JSON.stringify(document)).not.toContain("Bearer fake");
    });

    test("normalizes malformed v1 documents without treating root fields as legacy", () => {
        const current = {
            version: SETTINGS_SCHEMA_VERSION,
            global: {
                notifications: { timeout: 7500, position: "top-right" },
                authorization: "nested-secret",
            },
            sites: {
                grok: {
                    plugins: {
                        Keep: { enabled: true, nested: { flags: ["one", "two"] } },
                        Invalid: { enabled: "yes", privateValue: "drop-me" },
                    },
                    experiments: { workspace_agent: true },
                    presets: { compact: { density: 2 } },
                    cookies: ["site-secret"],
                },
                unexpected: {
                    plugins: { Foreign: { enabled: true, privateValue: "foreign-secret" } },
                    experiments: {},
                    presets: {},
                },
            },
            plugins: { LegacyRoot: { enabled: true, privateValue: "legacy-secret" } },
            notifications: { timeout: 1, position: "bottom-right" },
            authorization: "root-secret",
        };

        const migrated = migrateSettingsDocument(current);
        expect(migrated.changed).toBeTrue();
        expect(Object.keys(migrated.document.sites).toSorted()).toEqual([...SITE_IDS].toSorted());
        expect(migrated.document.global.notifications).toEqual({ timeout: 7500, position: "top-right" });
        expect(migrated.document.sites.grok).toEqual({
            plugins: { Keep: { enabled: true, nested: { flags: ["one", "two"] } } },
            experiments: { workspace_agent: true },
            presets: { compact: { density: 2 } },
        });
        expect(migrated.document.sites.grok.plugins.LegacyRoot).toBeUndefined();
        expect(JSON.stringify(migrated.document)).not.toMatch(/secret|drop-me/);
    });

    test("normalizes malformed notification and plugin shapes", () => {
        const current = createSettingsDocument() as unknown as Record<string, unknown>;
        const global = current.global as { notifications: Record<string, unknown> };
        global.notifications = { timeout: -1, position: "center", authorization: "secret" };
        const sites = current.sites as Record<string, Record<string, unknown>>;
        sites.claude.plugins = ["not-a-plugin-map"];
        sites.chatgpt.plugins = {
            Valid: { enabled: false, payload: { prompt: "preserve-me" } },
            MissingEnabled: { payload: true },
            InvalidEnabled: { enabled: 1 },
        };

        const { document, changed } = migrateSettingsDocument(current);
        expect(changed).toBeTrue();
        expect(document.global.notifications).toEqual({ timeout: 5000, position: "bottom-right" });
        expect(document.sites.claude.plugins).toEqual({});
        expect(document.sites.chatgpt.plugins).toEqual({ Valid: { enabled: false, payload: { prompt: "preserve-me" } } });
    });

    test("rejects unknown or incomplete versioned documents instead of migrating legacy roots", () => {
        for (const current of [
            { version: 2, plugins: legacy.plugins, notifications: legacy.notifications },
            { sites: {}, plugins: legacy.plugins, notifications: legacy.notifications },
            { global: {}, plugins: legacy.plugins, notifications: legacy.notifications },
        ]) {
            const { document, changed } = migrateSettingsDocument(current);
            expect(changed).toBeTrue();
            expect(document).toEqual(createSettingsDocument());
        }
    });
});

describe("site settings maintenance", () => {
    test("prunes only the selected site's removed plugins", () => {
        const document = createSettingsDocument();
        document.sites.grok.plugins = { Keep: { enabled: true }, Remove: { enabled: false } };
        document.sites.gemini.plugins = { Remove: { enabled: true } };
        expect(pruneSitePlugins(document, "grok", new Set(["Keep"]))).toEqual(["Remove"]);
        expect(document.sites.grok.plugins).toEqual({ Keep: { enabled: true } });
        expect(document.sites.gemini.plugins).toEqual({ Remove: { enabled: true } });
    });

    test("exports a rollback-compatible legacy Grok snapshot", () => {
        const { document } = migrateSettingsDocument(legacy);
        expect(JSON.parse(exportLegacySettings(document))).toEqual(legacy);
    });
});
