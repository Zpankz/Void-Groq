/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SiteId } from "./HostAdapter";

export type HostRuntimeId = "grok-turbopack" | "noop" | "router" | "dom";

export interface HostRuntime {
    id: HostRuntimeId;
    install(): void | Promise<void>;
    ready(): boolean | Promise<boolean>;
    teardown(): void | Promise<void>;
    findModule?(filter: (value: unknown) => boolean): unknown;
}

export interface HostRuntimeDefinition {
    id: HostRuntimeId;
    install(): void | Promise<void>;
    ready(): boolean | Promise<boolean>;
    teardown(): void | Promise<void>;
    findModule?(filter: (value: unknown) => boolean): unknown;
}

export function createHostRuntime(definition: HostRuntimeDefinition): HostRuntime {
    let installed = false;
    let tornDown = false;
    return {
        id: definition.id,
        findModule: definition.findModule,
        async install() {
            if (installed || tornDown) return;
            installed = true;
            await definition.install();
        },
        async ready() {
            if (!installed || tornDown) return false;
            return definition.ready();
        },
        async teardown() {
            if (tornDown) return;
            tornDown = true;
            await definition.teardown();
        },
    };
}

export function createPassiveHostRuntime(id: Exclude<HostRuntimeId, "grok-turbopack">): HostRuntime {
    return createHostRuntime({ id, install() {}, ready: () => true, teardown() {} });
}

export function resolveHostRuntime(site: SiteId | null, grok: HostRuntime): HostRuntime | null {
    if (!site) return null;
    if (site === "grok") return grok;
    if (site === "chatgpt") return createPassiveHostRuntime("router");
    if (site === "gemini" || site === "notebooklm") return createPassiveHostRuntime("dom");
    return createPassiveHostRuntime("noop");
}
