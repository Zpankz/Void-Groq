/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { evaluateWrite, POLICY_SITES, type PolicySite, type WriteDecisionReason } from "./Policy";

export const SITE_IDS = POLICY_SITES;
export type SiteId = PolicySite;
export type HostCapability = "overlay" | "catalog-read" | "flag-write" | "router-hook" | "angular-dom" | "turbopack";
export type HostCapabilities = Record<HostCapability, boolean>;
export interface LocationLike { hostname: string; }
export interface HostCatalogEntry { id: string; label: string; }
export interface HostWriter { write(key: string, value: boolean): void | Promise<void>; }

export interface HostAdapter {
    id: SiteId;
    match(location: LocationLike): boolean;
    capabilities: HostCapabilities;
    boot(): void | Promise<void>;
    ready(): void | Promise<void>;
    teardown(): void | Promise<void>;
    catalog(): readonly HostCatalogEntry[] | Promise<readonly HostCatalogEntry[]>;
    settingsMountPoint?(): Element | null;
    writer?: HostWriter;
}

export interface HostWriteResult {
    allowed: boolean;
    reason: WriteDecisionReason | "unavailable";
    written: boolean;
}

const SITE_HOSTS: Record<SiteId, readonly string[]> = {
    grok: ["grok.com"],
    claude: ["claude.ai"],
    chatgpt: ["chatgpt.com"],
    perplexity: ["perplexity.ai"],
    gemini: ["gemini.google.com"],
    notebooklm: ["notebooklm.google.com", "notebook.google.com"],
};
const CAPABILITIES: readonly HostCapability[] = ["overlay", "catalog-read", "flag-write", "router-hook", "angular-dom", "turbopack"];

export function detectSite(location: LocationLike): SiteId | null {
    const hostname = location.hostname.toLowerCase().replace(/\.+$/, "");
    if (!hostname || hostname.split(".").some(label => label.startsWith("xn--"))) return null;
    for (const site of SITE_IDS) {
        if (SITE_HOSTS[site].some(host => hostname === host || hostname.endsWith(`.${host}`))) return site;
    }
    return null;
}

export function createHostCapabilities(...available: HostCapability[]): HostCapabilities {
    const selected = new Set(available);
    return Object.fromEntries(CAPABILITIES.map(capability => [capability, selected.has(capability)])) as HostCapabilities;
}

export function resolveHostAdapter(location: LocationLike, adapters: readonly HostAdapter[]): HostAdapter | null {
    const site = detectSite(location);
    if (!site) return null;
    const matches = adapters.filter(adapter => adapter.id === site && adapter.match(location));
    return matches.length === 1 ? matches[0] : null;
}

export async function bootHostAdapter(location: LocationLike, adapters: readonly HostAdapter[]) {
    const adapter = resolveHostAdapter(location, adapters);
    if (!adapter) return null;
    await adapter.boot();
    return adapter;
}

export async function writeHostFlag(adapter: HostAdapter, key: string, value: boolean): Promise<HostWriteResult> {
    if (!adapter.capabilities["flag-write"] || !adapter.writer) return { allowed: false, reason: "unavailable", written: false };
    const decision = evaluateWrite({ site: adapter.id, capability: "feature-override", key });
    if (!decision.allowed) return { allowed: false, reason: decision.reason, written: false };
    await adapter.writer.write(key, value);
    return { allowed: true, reason: decision.reason, written: true };
}
