/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type HostCapabilities, type SiteId } from "./HostAdapter";

export const OVERLAY_ID = "void-portable-overlay";

export interface OverlayPluginItem {
    name: string;
    enabled: boolean;
    available: boolean;
    reason?: string;
}

export interface OverlaySection {
    id: "plugins" | "themes" | "css" | "experiments" | "diagnostics";
    label: string;
    items: readonly (OverlayPluginItem | string)[];
}

export interface OverlayModel {
    site: SiteId;
    warning: string;
    sections: readonly OverlaySection[];
}

export function createOverlayModel(site: SiteId, capabilities: HostCapabilities, plugins: readonly OverlayPluginItem[]): OverlayModel {
    return {
        site,
        warning: "Void controls are cosmetic, client-local, read-only, or DOM augmentation only. Client paint never implies server entitlement.",
        sections: [
            { id: "plugins", label: "Plugins", items: plugins },
            { id: "themes", label: "Themes", items: ["Theme settings are stored for this site."] },
            { id: "css", label: "Quick CSS", items: ["Quick CSS is stored locally for this site."] },
            { id: "experiments", label: "Experiments", items: ["Only reviewed cosmetic overrides can be written."] },
            { id: "diagnostics", label: "Diagnostics", items: Object.entries(capabilities).map(([name, available]) => `${name}: ${available ? "available" : "unavailable"}`) },
        ],
    };
}

export interface OverlayStateEffects {
    focusDialog(): void;
    restoreFocus(): void;
    changed(open: boolean): void;
}

export function createOverlayState(effects: OverlayStateEffects) {
    let open = false;
    return {
        isOpen: () => open,
        open() {
            if (open) return;
            open = true;
            effects.changed(true);
            effects.focusDialog();
        },
        close() {
            if (!open) return;
            open = false;
            effects.changed(false);
            effects.restoreFocus();
        },
        handleKey(key: string, shiftKey: boolean, atFirst: boolean, atLast: boolean) {
            if (!open) return "none" as const;
            if (key === "Escape") {
                this.close();
                return "closed" as const;
            }
            if (key !== "Tab") return "none" as const;
            if (shiftKey && atFirst) return "last" as const;
            if (!shiftKey && atLast) return "first" as const;
            return "none" as const;
        },
    };
}

export interface PortableOverlayOptions {
    model: OverlayModel;
    mountPoint?: Element;
}

export interface PortableOverlayHandle {
    open(): void;
    close(): void;
    teardown(): void;
}

const STYLE = `
:host{all:initial;color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}
button{font:inherit}.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#18181b;color:#fff;box-shadow:0 8px 24px #0005;cursor:pointer}.backdrop{position:fixed;inset:0;z-index:2147483647;display:none;place-items:center;padding:20px;background:#0009}.backdrop[data-open=true]{display:grid}.dialog{box-sizing:border-box;width:min(720px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid #ffffff26;border-radius:16px;padding:22px;background:#18181b;color:#fafafa;box-shadow:0 24px 80px #0009}.header{display:flex;align-items:center;justify-content:space-between;gap:16px}.close{border:0;border-radius:8px;padding:8px 12px;background:#ffffff16;color:inherit;cursor:pointer}.warning{margin:16px 0;padding:12px;border:1px solid #eab30880;border-radius:10px;background:#eab30818}.sections{display:grid;gap:12px}section{padding:14px;border:1px solid #ffffff20;border-radius:12px}h2{margin:0 0 8px;font-size:16px}p,li{font-size:14px;line-height:1.45}.unavailable{opacity:.65}
`;

export function installPortableOverlay(options: PortableOverlayOptions): PortableOverlayHandle {
    const existing = document.getElementById(OVERLAY_ID) as HTMLElement | null;
    if (existing?.shadowRoot) return createExistingHandle(existing);

    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.type = "button";
    launcher.textContent = "Void";
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.dataset.open = "false";
    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.tabIndex = -1;
    dialog.role = "dialog";
    dialog.ariaModal = "true";
    dialog.ariaLabel = `Void settings for ${options.model.site}`;
    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("h1");
    title.textContent = "Void settings";
    const closeButton = document.createElement("button");
    closeButton.className = "close";
    closeButton.type = "button";
    closeButton.textContent = "Close";
    header.append(title, closeButton);
    const warning = document.createElement("p");
    warning.className = "warning";
    warning.textContent = options.model.warning;
    const sections = document.createElement("div");
    sections.className = "sections";
    for (const sectionModel of options.model.sections) sections.append(renderSection(sectionModel));
    dialog.append(header, warning, sections);
    backdrop.append(dialog);
    root.append(style, launcher, backdrop);
    (options.mountPoint ?? document.documentElement).append(host);

    let restoreTarget: HTMLElement | null = null;
    const state = createOverlayState({
        focusDialog: () => dialog.focus(),
        restoreFocus: () => restoreTarget?.focus(),
        changed: open => { backdrop.dataset.open = String(open); launcher.hidden = open; },
    });
    const open = () => { restoreTarget = document.activeElement as HTMLElement | null; state.open(); };
    const close = () => state.close();
    const onKeyDown: EventListener = rawEvent => {
        const event = rawEvent as KeyboardEvent;
        const focusable = [...root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden);
        const result = state.handleKey(event.key, event.shiftKey, root.activeElement === focusable[0], root.activeElement === focusable.at(-1));
        if (result === "first" || result === "last") {
            event.preventDefault();
            focusable[result === "first" ? 0 : focusable.length - 1]?.focus();
        }
    };
    launcher.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
    root.addEventListener("keydown", onKeyDown);
    return { open, close, teardown: () => { state.close(); host.remove(); } };
}

function renderSection(model: OverlaySection) {
    const section = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = model.label;
    const list = document.createElement("ul");
    for (const item of model.items) {
        const row = document.createElement("li");
        if (typeof item === "string") row.textContent = item;
        else {
            row.textContent = `${item.name}: ${item.available ? (item.enabled ? "enabled" : "disabled") : item.reason ?? "unavailable"}`;
            if (!item.available) row.className = "unavailable";
        }
        list.append(row);
    }
    section.append(title, list);
    return section;
}

function createExistingHandle(host: HTMLElement): PortableOverlayHandle {
    const root = host.shadowRoot!;
    const launcher = root.querySelector<HTMLButtonElement>(".launcher");
    const backdrop = root.querySelector<HTMLElement>(".backdrop");
    return {
        open: () => launcher?.click(),
        close: () => root.querySelector<HTMLButtonElement>(".close")?.click(),
        teardown: () => { backdrop?.remove(); host.remove(); },
    };
}
