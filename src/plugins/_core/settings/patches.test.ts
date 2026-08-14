/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";

import { canonicalizeMatch } from "@utils/patches";
import { expect, test } from "bun:test";

const menuPattern = String.raw`(\(0,\i\.jsxs\)\(\i\.DropdownMenuItem,\{onSelect:\i,children:\[[^\]]{0,160}\i\("user-dropdown\.settings","Settings"\)\]\}\))`;
const footerPattern = String.raw`(\(0,\i\.jsxs\)\("div",\{className:\i,children:\[\i,\i,\i)(?=\]\}\),.{0,350}?analyticsName:"settings")`;
const pluginSource = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");

const menuFactory = '(0,t.jsxs)(A.DropdownMenuItem,{onSelect:eG,children:[(0,t.jsx)(h.CogIcon,{className:"size-4 me-2 text-fg-secondary"}),ey("user-dropdown.settings","Settings")]})';
const settingsFactory = 'P=(0,x.jsxs)("div",{className:C,children:[O,_,I]}),M[92]=P):P=M[92],M[93]!==W?(D=(0,x.jsxs)(j.ResponsiveDialog,{analyticsName:"settings",open:W})';

test("settings menu patch uses the live structural anchor", () => {
    expect(pluginSource).toContain(`match: /${menuPattern}/,`);
    const patched = menuFactory.replace(canonicalizeMatch(new RegExp(menuPattern)), "[$1,VOID_MENU]");
    expect(patched).toContain('ey("user-dropdown.settings","Settings")]}),VOID_MENU]');
});

test("settings footer patch is atomic and targets the positioned content container", () => {
    expect(pluginSource).toContain("find: \"pressed_cmd_settings\",\n            group: true,");
    expect(pluginSource).toContain(`match: /${footerPattern}/,`);
    const patched = settingsFactory.replace(canonicalizeMatch(new RegExp(footerPattern)), "$1,VOID_VERSION");
    expect(patched).toContain("children:[O,_,I,VOID_VERSION]})");
});
