/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect } from "@turbopack/common/react";
import { idbGet, idbSet } from "@utils/idb";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { SettingsStore as SettingsStoreClass, STORAGE_KEY } from "@utils/SettingsStore";
import { type DefinedSettings, OptionType, type PluginSettingDef, type PluginSettingValue, type SettingsChecks, type SettingsDefinition } from "@utils/types";

import { detectSite, type SiteId } from "./HostAdapter";
import { createSettingsDocument, exportLegacySettings, migrateSettingsDocument, type PluginSettings, type SettingsDocument } from "./SettingsSchema";

const logger = new Logger("Settings");

export type { NotificationPosition } from "./SettingsSchema";

export interface Settings {
    plugins: PluginSettings;
    notifications: SettingsDocument["global"]["notifications"];
}

const settingsDocument = createSettingsDocument();
let activeSite: SiteId = "grok";

export const SettingsStore = new SettingsStoreClass(settingsDocument);

export const PlainSettings: Settings = {
    get plugins() { return settingsDocument.sites[activeSite].plugins; },
    get notifications() { return settingsDocument.global.notifications; },
};
export const Settings: Settings = {
    get plugins() { return SettingsStore.store.sites[activeSite].plugins; },
    get notifications() { return SettingsStore.store.global.notifications; },
};

export const pluginPath = (name: string, key?: string) => key ? `sites.${activeSite}.plugins.${name}.${key}` : `sites.${activeSite}.plugins.${name}`;

export function getSettingsDocument() { return settingsDocument; }
export function getActiveSettingsSite() { return activeSite; }

/**
 * Exports pre-v1 VoidSettings JSON for rollback to a Grok-only build.
 * It includes global notifications and Grok plugins, and intentionally omits other site buckets plus every site's experiments and presets.
 */
export function exportSettingsForRollback() { return exportLegacySettings(settingsDocument); }

export async function initSettings(): Promise<void> {
    activeSite = detectSite(window.location) ?? "grok";
    let raw: string | null = null;
    let readFailed = false;
    if (typeof GM_getValue === "function") {
        try { raw = GM_getValue(STORAGE_KEY, null); } catch (e) { readFailed = true; logger.error("Failed to load settings:", e); }
    } else {

        try {
            raw = await idbGet<string>(STORAGE_KEY) ?? null;
        } catch (e) {
            readFailed = true;
            logger.warn("Failed to read IndexedDB:", e);
        }

        if (!raw) {
            raw = migrateFromLocalStorage();
            if (raw) idbSet(STORAGE_KEY, raw).then(() => {
                try { localStorage.removeItem(STORAGE_KEY); } catch {}
            }).catch((e: unknown) => logger.debug("Failed to persist settings to IndexedDB:", e));
        }
    }

    if (readFailed && !raw) return;
    try {
        const { document, changed } = migrateSettingsDocument(raw ? JSON.parse(raw) : null);
        Object.assign(settingsDocument, document);
        if (raw && changed) SettingsStore.markAsChanged();
    } catch (e) {
        logger.error("Failed to parse settings:", e);
    }
}

function migrateFromLocalStorage(): string | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            logger.info("Migrating settings from localStorage to IndexedDB");
            return raw;
        }
    } catch (e) {
        logger.warn("Failed to read localStorage:", e);
    }
    return null;
}

export function migratePluginSettings(name: string, ...oldNames: string[]) {
    if (name in Settings.plugins) return;

    for (const oldName of oldNames) {
        if (!(oldName in Settings.plugins)) continue;
        logger.info(`Migrating settings from old name ${oldName} to ${name}`);
        Settings.plugins[name] = Settings.plugins[oldName];
        delete Settings.plugins[oldName];
        break;
    }
}

export function migratePluginSetting(pluginName: string, newKey: string, oldKey: string) {
    const pluginSettings = Settings.plugins[pluginName];
    if (!pluginSettings || !(oldKey in pluginSettings) || newKey in pluginSettings) return;

    logger.info(`Migrating setting ${oldKey} -> ${newKey} in ${pluginName}`);
    const { [oldKey]: value, ...rest } = pluginSettings;
    Settings.plugins[pluginName] = { ...rest, [newKey]: value } as typeof pluginSettings;
}

export function migrateSettingsToPlugin(targetPlugin: string, sourcePlugin: string, ...settingKeys: string[]) {
    const source = Settings.plugins[sourcePlugin];
    if (!source) return;

    const target = { ...(Settings.plugins[targetPlugin] ?? { enabled: false }) };
    const remaining = { ...source };
    let changed = false;

    for (const key of settingKeys) {
        if (!(key in source) || key in target) continue;
        target[key] = source[key];
        delete remaining[key];
        changed = true;
    }

    if (!changed) return;
    logger.info(`Migrated settings [${settingKeys.join(", ")}] from ${sourcePlugin} to ${targetPlugin}`);
    Settings.plugins[targetPlugin] = target;
    Settings.plugins[sourcePlugin] = remaining;
}

export interface SettingsPluginData {
    themes?: import("@api/Themes").ThemeData[];
    themesEnabled?: boolean;
    customCSS?: string;
    customCSSEnabled?: boolean;
    knownPlugins?: Record<string, number>;
    chunkFingerprint?: string[];
    [key: string]: unknown;
}

export function getSettingsPluginData(): SettingsPluginData {
    return (Settings.plugins.Settings as SettingsPluginData) ?? {};
}

export function updateSettingsPluginData(patch: Partial<SettingsPluginData>) {
    Settings.plugins.Settings = { ...(Settings.plugins.Settings ?? { enabled: true }), ...patch };
}

export function mergePluginSettings(name: string, patch: Record<string, unknown>) {
    Settings.plugins[name] = { ...(Settings.plugins[name] ?? { enabled: false }), ...patch };
}

export function resolveDefault(setting: PluginSettingDef): PluginSettingValue | undefined {
    if ("default" in setting) return setting.default as PluginSettingValue;
    if (setting.type === OptionType.SELECT) return setting.options.find(o => o.default)?.value;
    return undefined;
}

export function definePluginSettings<Def extends SettingsDefinition, Checks extends SettingsChecks<Def>, PrivateSettings extends object = {}>(def: Def, checks?: Checks) {
    let _pluginName = "";

    type Store = DefinedSettings<Def, Checks, PrivateSettings>["store"];

    const definedSettings: DefinedSettings<Def, Checks, PrivateSettings> = {
        get store() {
            if (!_pluginName) throw new Error("Cannot access settings before plugin is initialized");
            return Settings.plugins[_pluginName] as unknown as Store;
        },
        get plain() {
            if (!_pluginName) throw new Error("Cannot access settings before plugin is initialized");
            return PlainSettings.plugins[_pluginName] as unknown as Store;
        },
        def,
        checks: (checks ?? {}) as Checks,
        get pluginName() {
            return _pluginName;
        },
        set pluginName(name: string) {
            _pluginName = name;
            if (!name) return;

            if (!PlainSettings.plugins[name]) PlainSettings.plugins[name] = { enabled: false };

            SettingsStore.setDefaultGetter(pluginPath(name), key => {
                const setting = def[key];
                return setting ? resolveDefault(setting) : undefined;
            });
        },
        use(keys) {
            const forceUpdate = useForceUpdater();

            useEffect(() => {
                const prefix = pluginPath(_pluginName);
                let listener: (path: string) => void = forceUpdate;
                if (keys?.length) {
                    const watched = keys.map(k => `${prefix}.${String(k)}`);
                    listener = path => {
                        if (watched.some(p => path.startsWith(p) || p.startsWith(path + "."))) forceUpdate();
                    };
                }
                SettingsStore.addPrefixChangeListener(prefix, listener);
                return () => SettingsStore.removePrefixChangeListener(prefix, listener);
            }, []);

            return definedSettings.store;
        },
        withPrivateSettings<T extends object>() {
            return this as unknown as DefinedSettings<Def, Checks, T>;
        },
    };

    return definedSettings;
}
