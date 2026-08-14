/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, describe, expect, test } from "bun:test";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const gmSetValueDescriptor = Object.getOwnPropertyDescriptor(globalThis, "GM_setValue");
const isDevDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_DEV");
const isExtensionDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_EXTENSION");
const htmlElementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
const messagePortDescriptor = Object.getOwnPropertyDescriptor(globalThis, "MessagePort");
Object.defineProperties(globalThis, {
    window: { configurable: true, value: { addEventListener() {} } },
    GM_setValue: { configurable: true, value() {} },
    IS_DEV: { configurable: true, value: false },
    IS_EXTENSION: { configurable: true, value: false },
    HTMLElement: { configurable: true, value: class HTMLElement extends EventTarget {} },
    MessagePort: { configurable: true, value: class MessagePort extends EventTarget {} },
});

const { migratePluginSettings, PlainSettings, Settings, SettingsStore } = await import("./Settings");

interface RenamedSettings {
    enabled: boolean;
    nested: { flag: boolean };
}

afterAll(() => {
    SettingsStore.flush();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete (globalThis as { window?: Window }).window;
    if (gmSetValueDescriptor) Object.defineProperty(globalThis, "GM_setValue", gmSetValueDescriptor);
    else delete (globalThis as { GM_setValue?: typeof GM_setValue }).GM_setValue;
    if (isDevDescriptor) Object.defineProperty(globalThis, "IS_DEV", isDevDescriptor);
    else delete (globalThis as { IS_DEV?: boolean }).IS_DEV;
    if (isExtensionDescriptor) Object.defineProperty(globalThis, "IS_EXTENSION", isExtensionDescriptor);
    else delete (globalThis as { IS_EXTENSION?: boolean }).IS_EXTENSION;
    if (htmlElementDescriptor) Object.defineProperty(globalThis, "HTMLElement", htmlElementDescriptor);
    else delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
    if (messagePortDescriptor) Object.defineProperty(globalThis, "MessagePort", messagePortDescriptor);
    else delete (globalThis as { MessagePort?: typeof MessagePort }).MessagePort;
});

describe("migratePluginSettings", () => {
    test("fresh-clones renamed settings so nested writes notify only the new path", () => {
        const oldName = "OldFixturePlugin";
        const newName = "RenamedFixturePlugin";
        const oldPrefix = `sites.grok.plugins.${oldName}`;
        const newPrefix = `sites.grok.plugins.${newName}`;
        const oldPaths: string[] = [];
        const newPaths: string[] = [];
        const onOldPath = (path: string) => oldPaths.push(path);
        const onNewPath = (path: string) => newPaths.push(path);

        Settings.plugins[oldName] = { enabled: true, nested: { flag: false } };
        SettingsStore.addPrefixChangeListener(oldPrefix, onOldPath);
        SettingsStore.addPrefixChangeListener(newPrefix, onNewPath);

        migratePluginSettings(newName, oldName);
        oldPaths.length = 0;
        newPaths.length = 0;
        (Settings.plugins[newName] as unknown as RenamedSettings).nested.flag = true;

        expect(oldPaths).toEqual([]);
        expect(newPaths).toEqual([`${newPrefix}.nested.flag`]);
        expect(() => structuredClone(PlainSettings.plugins[newName])).not.toThrow();

        SettingsStore.removePrefixChangeListener(oldPrefix, onOldPath);
        SettingsStore.removePrefixChangeListener(newPrefix, onNewPath);
        delete Settings.plugins[newName];
    });
});
