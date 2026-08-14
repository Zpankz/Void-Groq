/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";

import { expect, test } from "bun:test";

const runtimePath = new URL("./runtime.ts", import.meta.url);
const voidPath = new URL("../../Void.ts", import.meta.url);
const patchReportPath = new URL("../../turbopack/patchReport.ts", import.meta.url);
const patcherPath = new URL("../../turbopack/patchTurbopack.ts", import.meta.url);

test("locks the default Grok runtime to existing patch and readiness seams", async () => {
    const source = await readFile(runtimePath, "utf8");
    expect(source).toContain("install: patchTurbopack");
    expect(source).toContain('filters.byProps("useRoutingStore", "formatUrl")');
    expect(source).toContain("setTimeout(callback, FALLBACK_MS)");
    expect(source).toContain("reportError:");
});

test("chains runtime readiness to successful installation on every host", async () => {
    const source = await readFile(voidPath, "utf8");
    expect(source).not.toContain("useRoutingStore");
    expect(source).not.toContain('safely("patchTurbopack"');
    expect(source).toContain("await runtime.install()");
    expect(source).toContain("if (await runtime.ready()) onReady?.()");
    expect(source).toContain('logger.error("hostRuntime.install failed:", error)');
    expect(source).toContain('logger.error("hostRuntime.ready failed:", error)');
    expect(source).toContain("void startHostRuntime(activeRuntime);");
    expect(source).toContain("void startHostRuntime(activeRuntime, finishRuntimeReady);");
});

test("does not modify Turbopack patch or report implementation", async () => {
    const [report, patcher] = await Promise.all([readFile(patchReportPath, "utf8"), readFile(patcherPath, "utf8")]);
    expect(report).toContain("export function patchReport()");
    expect(patcher).toContain("export const patches: Patch[] = []");
    expect(patcher).toContain("export function patchTurbopack(): void");
});
