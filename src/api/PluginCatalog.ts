/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HostCapabilities, HostCapability, SiteId } from "./HostAdapter";

export interface PluginAvailabilityDefinition {
    name: string;
    sites?: readonly SiteId[];
    capabilities?: readonly HostCapability[];
    dependencies?: readonly string[];
}

export type PluginAvailability =
    | { available: true }
    | { available: false; reason: "site"; supportedSites: readonly SiteId[] }
    | { available: false; reason: "capability"; missingCapabilities: readonly HostCapability[] }
    | { available: false; reason: "dependency"; dependency: string };

export function evaluatePluginAvailability(plugin: PluginAvailabilityDefinition, site: SiteId, capabilities: HostCapabilities): PluginAvailability {
    const supportedSites = plugin.sites ?? ["grok"];
    if (!supportedSites.includes(site)) return { available: false, reason: "site", supportedSites };
    const missingCapabilities = (plugin.capabilities ?? []).filter(capability => !capabilities[capability]);
    if (missingCapabilities.length) return { available: false, reason: "capability", missingCapabilities };
    return { available: true };
}

export function evaluatePluginTree(plugin: PluginAvailabilityDefinition, catalog: Record<string, PluginAvailabilityDefinition>, site: SiteId, capabilities: HostCapabilities, visiting = new Set<string>()): PluginAvailability {
    const own = evaluatePluginAvailability(plugin, site, capabilities);
    if (!own.available) return own;
    for (const dependency of plugin.dependencies ?? []) {
        if (visiting.has(dependency)) return { available: false, reason: "dependency", dependency };
        const child = catalog[dependency];
        if (!child) return { available: false, reason: "dependency", dependency };
        const next = new Set(visiting).add(plugin.name);
        if (!evaluatePluginTree(child, catalog, site, capabilities, next).available) return { available: false, reason: "dependency", dependency };
    }
    return { available: true };
}

export function runWhenPluginAvailable<T>(plugin: PluginAvailabilityDefinition, catalog: Record<string, PluginAvailabilityDefinition>, site: SiteId, capabilities: HostCapabilities, effect: () => T) {
    if (!evaluatePluginTree(plugin, catalog, site, capabilities).available) return;
    return effect();
}

export function describePluginAvailability(availability: PluginAvailability) {
    if (availability.available) return null;
    if (availability.reason === "site") return `Unavailable on this site. Supported: ${availability.supportedSites.join(", ")}.`;
    if (availability.reason === "capability") return `Unavailable because this site lacks: ${availability.missingCapabilities.join(", ")}.`;
    return `Unavailable because dependency ${availability.dependency} is not available.`;
}
