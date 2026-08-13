/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

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
