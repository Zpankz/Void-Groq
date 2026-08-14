/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, mock, test } from "bun:test";

import { createHostCapabilities } from "./HostAdapter";
import { createOverlayModel, createOverlayState, OVERLAY_ID } from "./PortableOverlay";

const model = createOverlayModel("claude", createHostCapabilities("overlay", "catalog-read"), [
    { name: "Portable", enabled: true, available: true },
    { name: "GrokOnly", enabled: false, available: false, reason: "Unavailable on this site." },
]);

describe("portable overlay", () => {
    test("renders every portable settings section without Grok dependencies", () => {
        expect(model.sections.map(section => section.id)).toEqual(["plugins", "themes", "css", "experiments", "diagnostics"]);
        expect(model.warning).toContain("cosmetic, client-local, read-only, or DOM augmentation");
        expect(model.sections[0].items).toHaveLength(2);
        expect(model.sections[4].items).toContain("catalog-read: available");
    });

    test("opens once, focuses the dialog, closes on escape, and restores focus", () => {
        const focusDialog = mock(() => {});
        const restoreFocus = mock(() => {});
        const changed = mock(() => {});
        const state = createOverlayState({ focusDialog, restoreFocus, changed });
        state.open();
        state.open();
        expect(state.isOpen()).toBeTrue();
        expect(focusDialog).toHaveBeenCalledTimes(1);
        expect(state.handleKey("Escape", false, false, false)).toBe("closed");
        expect(state.isOpen()).toBeFalse();
        expect(restoreFocus).toHaveBeenCalledTimes(1);
    });

    test("traps tab focus at both dialog boundaries", () => {
        const state = createOverlayState({ focusDialog() {}, restoreFocus() {}, changed() {} });
        state.open();
        expect(state.handleKey("Tab", false, false, true)).toBe("first");
        expect(state.handleKey("Tab", true, true, false)).toBe("last");
        expect(state.handleKey("Tab", false, false, false)).toBe("none");
    });

    test("uses a stable mount identity to prevent duplicate mounts under host rerenders", () => {
        expect(OVERLAY_ID).toBe("void-portable-overlay");
        const mounted = new Set<string>();
        const mount = () => mounted.has(OVERLAY_ID) ? false : (mounted.add(OVERLAY_ID), true);
        expect(mount()).toBeTrue();
        expect(mount()).toBeFalse();
        expect(mounted.size).toBe(1);
    });
});
