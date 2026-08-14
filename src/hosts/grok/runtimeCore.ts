/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHostRuntime, type HostRuntime } from "@api/HostRuntime";

export interface GrokRuntimeDependencies {
    install(): void;
    rescan(): void;
    blacklist(): void;
    waitUntilReady(callback: () => void): () => void;
    scheduleFallback(callback: () => void): ReturnType<typeof setTimeout>;
    cancelFallback(timer: ReturnType<typeof setTimeout>): void;
}

export function createGrokRuntime(dependencies: GrokRuntimeDependencies): HostRuntime {
    let cancelWait: () => void = Function.prototype as () => void;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveReady: (ready: boolean) => void = Function.prototype as (ready: boolean) => void;
    const ready = new Promise<boolean>(resolve => { resolveReady = resolve; });
    let complete = false;

    const fire = () => {
        if (complete) return;
        complete = true;
        cancelWait();
        if (fallbackTimer) dependencies.cancelFallback(fallbackTimer);
        dependencies.rescan();
        dependencies.blacklist();
        resolveReady(true);
    };

    return createHostRuntime({
        id: "grok-turbopack",
        install: dependencies.install,
        async ready() {
            cancelWait = dependencies.waitUntilReady(fire);
            if (!complete) fallbackTimer = dependencies.scheduleFallback(fire);
            return ready;
        },
        teardown() {
            cancelWait();
            if (fallbackTimer) dependencies.cancelFallback(fallbackTimer);
            complete = true;
            resolveReady(false);
        },
    });
}
