/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, mock, test } from "bun:test";

import { createGrokRuntime } from "./runtimeCore";

function dependencies(synchronous = false, failures = new Set<string>()) {
    const events: string[] = [];
    let callback: () => void = Function.prototype as () => void;
    const record = (name: string) => {
        events.push(name);
        if (failures.has(name)) throw new Error(name);
    };
    const cancel = mock(() => record("cancel"));
    const cancelFallback = mock(() => record("cancel-fallback"));
    const deps = {
        install: mock(() => events.push("install")),
        rescan: mock(() => record("rescan")),
        blacklist: mock(() => record("blacklist")),
        waitUntilReady: mock((ready: () => void) => {
            callback = ready;
            if (synchronous) ready();
            return cancel;
        }),
        scheduleFallback: mock(() => 1 as unknown as ReturnType<typeof setTimeout>),
        cancelFallback,
        reportError: mock((name: string) => events.push(`error:${name}`)),
    };
    return { deps, events, fire: () => callback(), cancel, cancelFallback };
}

test("preserves install and ready ordering", async () => {
    const fixture = dependencies();
    const runtime = createGrokRuntime(fixture.deps);
    await runtime.install();
    const ready = runtime.ready();
    expect(fixture.events).toEqual(["install"]);
    fixture.fire();
    await expect(ready).resolves.toBeTrue();
    expect(fixture.events).toEqual(["install", "cancel", "cancel-fallback", "rescan", "blacklist"]);
});

test("handles synchronous ready signals without a temporal dead zone", async () => {
    const fixture = dependencies(true);
    const runtime = createGrokRuntime(fixture.deps);
    await runtime.install();
    await expect(runtime.ready()).resolves.toBeTrue();
    expect(fixture.deps.rescan).toHaveBeenCalledTimes(1);
    expect(fixture.deps.scheduleFallback).not.toHaveBeenCalled();
});

test("settles readiness and reports cleanup and scan failures", async () => {
    const fixture = dependencies(false, new Set(["cancel", "cancel-fallback", "rescan", "blacklist"]));
    const runtime = createGrokRuntime(fixture.deps);
    await runtime.install();
    const ready = runtime.ready();
    fixture.fire();
    await expect(ready).resolves.toBeTrue();
    expect(fixture.events).toEqual([
        "install",
        "cancel",
        "error:cancelWait",
        "cancel-fallback",
        "error:cancelFallback",
        "rescan",
        "error:rescan",
        "blacklist",
        "error:blacklist",
    ]);
});

test("settles cancelled readiness when cleanup fails", async () => {
    const fixture = dependencies(false, new Set(["cancel", "cancel-fallback"]));
    const runtime = createGrokRuntime(fixture.deps);
    await runtime.install();
    const ready = runtime.ready();
    await runtime.teardown();
    await expect(ready).resolves.toBeFalse();
    expect(fixture.events).toEqual([
        "install",
        "cancel",
        "error:cancelWait",
        "cancel-fallback",
        "error:cancelFallback",
    ]);
});

test("cancels readiness exactly once on repeated teardown", async () => {
    const fixture = dependencies();
    const runtime = createGrokRuntime(fixture.deps);
    await runtime.install();
    const ready = runtime.ready();
    await runtime.teardown();
    await runtime.teardown();
    await expect(ready).resolves.toBeFalse();
    fixture.fire();
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.deps.rescan).not.toHaveBeenCalled();
    expect(fixture.deps.blacklist).not.toHaveBeenCalled();
});
