/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const REDACTED = "[REDACTED]";

export type RedactionCategory = "authorization" | "cookie" | "jwt" | "email" | "api-key" | "session" | "token" | "url-secret";

export interface RedactionLogEntry {
    category: RedactionCategory;
    path: string;
    count: number;
}

export interface RedactionResult<T> {
    value: T;
    log: RedactionLogEntry[];
}

const FIELD_PATTERNS: readonly [RedactionCategory, RegExp][] = [
    ["authorization", /^(authorization|proxy[_-]?authorization)$/i],
    ["cookie", /^(cookie|set[_-]?cookie)$/i],
    ["jwt", /(^|[_-])jwt($|[_-])/i],
    ["email", /(^|[_-])email($|[_-])/i],
    ["api-key", /(^|[_-])(api[_-]?key|x[_-]?api[_-]?key)($|[_-])/i],
    ["session", /(^|[_-])(session|sessionid|session[_-]?token)($|[_-])/i],
    ["token", /(^|[_-])(access[_-]?token|id[_-]?token|refresh[_-]?token|token)($|[_-])/i],
];
const URL_SECRET_KEYS = new Set(["access_token", "code", "email", "id_token", "jwt", "session", "state", "token"]);
const TEXT_PATTERNS: readonly [RedactionCategory, RegExp][] = [
    ["authorization", /(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi],
    ["cookie", /(cookie\s*:\s*)[^\r\n]+/gi],
    ["jwt", /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
];

function categoryForField(key: string) {
    return FIELD_PATTERNS.find(([, pattern]) => pattern.test(key))?.[0];
}

function addLog(log: RedactionLogEntry[], category: RedactionCategory, path: string, count = 1) {
    const existing = log.find(entry => entry.category === category && entry.path === path);
    if (existing) existing.count += count;
    else log.push({ category, path, count });
}

function redactParams(value: string, path: string, log: RedactionLogEntry[]) {
    const params = new URLSearchParams(value);
    const output = new URLSearchParams();
    let changed = false;
    for (const [key, current] of params) {
        if (URL_SECRET_KEYS.has(key.toLowerCase())) {
            output.append(key, REDACTED);
            addLog(log, "url-secret", `${path}.${key}`);
            changed = true;
            continue;
        }
        const redacted = redactTextAtPath(current, `${path}.${key}`, log);
        output.append(key, redacted);
        if (redacted !== current) changed = true;
    }
    return changed ? output.toString() : value;
}

function redactUrl(value: string, path: string, log: RedactionLogEntry[]) {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    if (!absolute && !value.startsWith("/") && !value.startsWith("#")) return null;
    let url: URL;
    try {
        url = new URL(value, "https://void.invalid");
    } catch {
        return null;
    }
    if (url.username) {
        url.username = REDACTED;
        addLog(log, "url-secret", `${path}.username`);
    }
    if (url.password) {
        url.password = REDACTED;
        addLog(log, "url-secret", `${path}.password`);
    }
    let decodedPath = url.pathname;
    try { decodedPath = decodeURIComponent(decodedPath); } catch {}
    const pathname = redactTextAtPath(decodedPath, `${path}.path`, log);
    if (pathname !== decodedPath) url.pathname = pathname;
    const query = redactParams(url.search.slice(1), `${path}.query`, log);
    if (query !== url.search.slice(1)) url.search = query;
    if (url.hash.length > 1) {
        const fragment = url.hash.slice(1);
        const separator = fragment.indexOf("?");
        const route = separator < 0 ? "" : fragment.slice(0, separator + 1);
        const params = separator < 0 ? fragment : fragment.slice(separator + 1);
        const hash = redactParams(params, `${path}.hash`, log);
        if (hash !== params) url.hash = `${route}${hash}`;
    }
    if (absolute) return url.toString();
    if (value.startsWith("#")) return url.hash;
    return `${url.pathname}${url.search}${url.hash}`;
}

function redactTextAtPath(value: string, path: string, log: RedactionLogEntry[]) {
    let redacted = value;
    for (const [category, pattern] of TEXT_PATTERNS) {
        let count = 0;
        redacted = redacted.replace(pattern, match => {
            count++;
            const separator = match.search(/[:=]/);
            return separator < 0 ? REDACTED : `${match.slice(0, separator + 1)} ${REDACTED}`;
        });
        if (count) addLog(log, category, path, count);
    }
    return redacted;
}

function redactNode(value: unknown, path: string, log: RedactionLogEntry[]): unknown {
    if (typeof value === "string") {
        const redactionPath = path || "$";
        return redactUrl(value, redactionPath, log) ?? redactTextAtPath(value, redactionPath, log);
    }
    if (Array.isArray(value)) return value.map((item, index) => redactNode(item, `${path || "$"}[${index}]`, log));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        const category = categoryForField(key);
        if (category) {
            output[key] = REDACTED;
            addLog(log, category, childPath);
        } else output[key] = redactNode(child, childPath, log);
    }
    return output;
}

export function redactValue<T>(value: T): RedactionResult<T> {
    const log: RedactionLogEntry[] = [];
    return { value: redactNode(value, "", log) as T, log };
}

export function redactText(value: string): RedactionResult<string> {
    const log: RedactionLogEntry[] = [];
    return { value: redactTextAtPath(value, "text", log), log };
}

export async function persistRedacted<T, R>(value: T, write: (redacted: T) => Promise<R>) {
    const redacted = redactValue(value);
    return { result: await write(redacted.value), log: redacted.log };
}
