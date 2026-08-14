/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isObject } from "@utils/guards";

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

const DEFAULT_NOTIFICATIONS: SettingsDocument["global"]["notifications"] = { timeout: 5000, position: "bottom-right" };
const DOCUMENT_KEYS = ["version", "global", "sites"];
const GLOBAL_KEYS = ["notifications"];
const NOTIFICATION_KEYS = ["timeout", "position"];
const SITE_KEYS = ["plugins", "experiments", "presets"];

function createSiteSettings(): SiteSettings {
    return { plugins: {}, experiments: {}, presets: {} };
}

export function createSettingsDocument(): SettingsDocument {
    return {
        version: SETTINGS_SCHEMA_VERSION,
        global: { notifications: { ...DEFAULT_NOTIFICATIONS } },
        sites: Object.fromEntries(SITE_IDS.map(site => [site, createSiteSettings()])) as Record<SiteId, SiteSettings>,
    };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
    const keys = Object.keys(value);
    return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

function isNotificationSettings(value: unknown): value is SettingsDocument["global"]["notifications"] {
    return isObject(value)
        && hasOnlyKeys(value, NOTIFICATION_KEYS)
        && typeof value.timeout === "number"
        && Number.isFinite(value.timeout)
        && value.timeout >= 0
        && (value.position === "top-right" || value.position === "bottom-right");
}

function isPluginSettings(value: unknown): value is PluginSettings {
    return isObject(value) && Object.values(value).every(plugin => isObject(plugin) && typeof plugin.enabled === "boolean");
}

function isSiteSettings(value: unknown): value is SiteSettings {
    return isObject(value)
        && hasOnlyKeys(value, SITE_KEYS)
        && isPluginSettings(value.plugins)
        && isObject(value.experiments)
        && isObject(value.presets);
}

function isSettingsDocument(value: unknown): value is SettingsDocument {
    if (!isObject(value) || value.version !== SETTINGS_SCHEMA_VERSION || !hasOnlyKeys(value, DOCUMENT_KEYS)) return false;
    if (!isObject(value.global) || !hasOnlyKeys(value.global, GLOBAL_KEYS) || !isNotificationSettings(value.global.notifications)) return false;
    const { sites } = value;
    return isObject(sites)
        && hasOnlyKeys(sites, SITE_IDS)
        && SITE_IDS.every(site => isSiteSettings(sites[site]));
}

function normalizeNotifications(value: unknown): SettingsDocument["global"]["notifications"] {
    const notifications = { ...DEFAULT_NOTIFICATIONS };
    if (!isObject(value)) return notifications;
    if (typeof value.timeout === "number" && Number.isFinite(value.timeout) && value.timeout >= 0) notifications.timeout = value.timeout;
    if (value.position === "top-right" || value.position === "bottom-right") notifications.position = value.position;
    return notifications;
}

function normalizePluginSettings(value: unknown): PluginSettings {
    if (!isObject(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter((entry): entry is [string, PluginSettings[string]] => isObject(entry[1]) && typeof entry[1].enabled === "boolean")
        .map(([name, settings]) => [name, structuredClone(settings)]));
}

function normalizeSiteSettings(value: unknown): SiteSettings {
    if (!isObject(value)) return createSiteSettings();
    return {
        plugins: normalizePluginSettings(value.plugins),
        experiments: isObject(value.experiments) ? structuredClone(value.experiments) : {},
        presets: isObject(value.presets) ? structuredClone(value.presets) : {},
    };
}

function normalizeVersionedDocument(value: Record<string, unknown>): SettingsDocument {
    const document = createSettingsDocument();
    if (value.version !== SETTINGS_SCHEMA_VERSION) return document;
    if (isObject(value.global)) document.global.notifications = normalizeNotifications(value.global.notifications);
    const { sites } = value;
    if (isObject(sites)) {
        for (const site of SITE_IDS) document.sites[site] = normalizeSiteSettings(sites[site]);
    }
    return document;
}

export function migrateSettingsDocument(value: unknown) {
    if (isSettingsDocument(value)) return { document: value, changed: false };
    const document = createSettingsDocument();
    if (!isObject(value)) return { document, changed: true };
    if (DOCUMENT_KEYS.some(key => Object.hasOwn(value, key))) {
        return { document: normalizeVersionedDocument(value), changed: true };
    }
    document.sites.grok.plugins = normalizePluginSettings(value.plugins);
    document.global.notifications = normalizeNotifications(value.notifications);
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
