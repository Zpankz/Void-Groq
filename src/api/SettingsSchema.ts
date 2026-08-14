/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SITE_IDS, type SiteId } from "./HostAdapter";

export const SETTINGS_SCHEMA_VERSION = 1;

export type NotificationPosition = "top-right" | "bottom-right";
export type PluginSettings = Record<string, { enabled: boolean; [setting: string]: unknown }>;

export interface SiteSettings {
    plugins: PluginSettings;
    experiments: Record<string, unknown>;
    presets: Record<string, unknown>;
}

export interface SettingsDocument {
    version: typeof SETTINGS_SCHEMA_VERSION;
    global: {
        notifications: {
            timeout: number;
            position: NotificationPosition;
        };
    };
    sites: Record<SiteId, SiteSettings>;
}

export interface LegacySettings {
    plugins: PluginSettings;
    notifications: SettingsDocument["global"]["notifications"];
}

function createSiteSettings(): SiteSettings {
    return { plugins: {}, experiments: {}, presets: {} };
}

export function createSettingsDocument(): SettingsDocument {
    return {
        version: SETTINGS_SCHEMA_VERSION,
        global: { notifications: { timeout: 5000, position: "bottom-right" } },
        sites: Object.fromEntries(SITE_IDS.map(site => [site, createSiteSettings()])) as Record<SiteId, SiteSettings>,
    };
}

function isSettingsDocument(value: unknown): value is SettingsDocument {
    return !!value && typeof value === "object" && (value as { version?: unknown }).version === SETTINGS_SCHEMA_VERSION && "global" in value && "sites" in value;
}

export function migrateSettingsDocument(value: unknown) {
    if (isSettingsDocument(value)) return { document: value, changed: false };
    const document = createSettingsDocument();
    if (!value || typeof value !== "object") return { document, changed: true };
    const legacy = value as Partial<LegacySettings>;
    if (legacy.plugins && typeof legacy.plugins === "object") document.sites.grok.plugins = structuredClone(legacy.plugins);
    if (legacy.notifications && typeof legacy.notifications === "object") document.global.notifications = structuredClone(legacy.notifications);
    return { document, changed: true };
}

export function pruneSitePlugins(document: SettingsDocument, site: SiteId, available: ReadonlySet<string>) {
    const removed: string[] = [];
    for (const name of Object.keys(document.sites[site].plugins)) {
        if (available.has(name)) continue;
        removed.push(name);
        delete document.sites[site].plugins[name];
    }
    return removed;
}

export function exportLegacySettings(document: SettingsDocument) {
    return JSON.stringify({ plugins: document.sites.grok.plugins, notifications: document.global.notifications });
}
