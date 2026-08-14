/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { blacklistBadModules, patchTurbopack, rescanRuntimeModules } from "@turbopack/patchTurbopack";
import { filters, waitFor } from "@turbopack/turbopack";
import { Logger } from "@utils/Logger";

import { createGrokRuntime } from "./runtimeCore";

const logger = new Logger("HostRuntime", "#e78284");

const FALLBACK_MS = 15_000;

export function createDefaultGrokRuntime() {
    return createGrokRuntime({
        install: patchTurbopack,
        rescan: rescanRuntimeModules,
        blacklist: blacklistBadModules,
        waitUntilReady: callback => waitFor(filters.byProps("useRoutingStore", "formatUrl"), callback),
        scheduleFallback: callback => setTimeout(callback, FALLBACK_MS),
        cancelFallback: clearTimeout,
        reportError: (name, error) => logger.error(`${name} failed:`, error),
    });
}
