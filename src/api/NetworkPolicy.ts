/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PolicySite } from "./Policy";

export type TrialRequestCategory =
    | "passive-read"
    | "telemetry"
    | "completion"
    | "billing"
    | "checkout"
    | "connector-oauth"
    | "plugin-mutation"
    | "upload"
    | "share"
    | "delete"
    | "account-switch"
    | "staff-override"
    | "unknown-mutation";

export interface TrialRequestInput {
    site: PolicySite;
    method?: string;
    url: string | URL | Request;
    baseUrl: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
}

export interface BlockedRequestEvidence {
    trialId?: string;
    site: PolicySite;
    category: TrialRequestCategory;
    method: string;
    origin: string;
    path: string;
    queryNames: string[];
    contentType: string;
    bodyBytes: number;
    bodyKeys: string[];
    blocked: boolean;
}

export interface TrialRequestDecision {
    blocked: boolean;
    category: TrialRequestCategory;
    evidence: BlockedRequestEvidence;
}

export type TrialFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TrialFetchOptions {
    site: PolicySite;
    trialId: string;
    baseUrl: string;
    fetchImpl: TrialFetch;
    onBlocked(evidence: BlockedRequestEvidence): void;
}

const PASSIVE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TELEMETRY_PATTERN = /(^|\/)(log_metric|telemetry|sentry|mixpanel|datadog|rum)(\/|$)/;
const COMPLETION_PATTERN = /(chat|conversation|completion|responses?|messages?|prompt|stream|ask)/;
const BILLING_PATTERN = /(billing|subscription|entitlement|invoice|refund|plan[_/-](change|update|cancel))/;
const CHECKOUT_PATTERN = /(checkout|payment[_/-]?method|stripe|paypal)/;
const OAUTH_PATTERN = /(oauth|authorize|callback|connector[_/-]?(token|auth)|enableconnector)/;
const CONNECTOR_MARKER_PATTERN = /(^|[_/.-])(connectors?|plugins?|mcp)([_/.-]|$)|enableconnector/;
const PLUGIN_PATTERN = /(plugins?|skills?|marketplace|mcp)[_/-]?(install|enable|disable|remove|update)/;
const UPLOAD_PATTERN = /(upload|multipart|ingest|sources?[_/-]?(add|create|upload))/;
const SHARE_PATTERN = /(share|public[_/-]?link|invite|access[_/-]?(grant|update)|\bacl\b)/;
const DELETE_PATTERN = /(delete|destroy|bulk[_/-]?delete)/;
const ACCOUNT_PATTERN = /(accounts?[_/-]?(switch|persist|save)|cookie[_/-]?swap|logout[_/-]?others)/;

function getBodyKeys(value: unknown, prefix = "", depth = 0): string[] {
    if (!value || typeof value !== "object" || depth > 1) return [];
    const keys: string[] = [];
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child) && depth < 1) keys.push(...getBodyKeys(child, path, depth + 1));
        else keys.push(path);
    }
    return keys;
}

function inspectBody(body: BodyInit | null | undefined) {
    if (typeof body === "string") {
        let bodyKeys: string[] = [];
        try {
            bodyKeys = getBodyKeys(JSON.parse(body));
        } catch {
            bodyKeys = [...new URLSearchParams(body).keys()];
        }
        return { bodyBytes: new TextEncoder().encode(body).byteLength, bodyKeys, bodyText: body.toLowerCase() };
    }
    if (body instanceof URLSearchParams) return { bodyBytes: body.size, bodyKeys: [...body.keys()], bodyText: "" };
    if (body instanceof Blob) return { bodyBytes: body.size, bodyKeys: [], bodyText: body.type.toLowerCase() };
    if (body instanceof FormData) return { bodyBytes: 0, bodyKeys: [...body.keys()], bodyText: "multipart" };
    return { bodyBytes: 0, bodyKeys: [], bodyText: "" };
}

function normalizeUrl(input: string | URL | Request, baseUrl: string) {
    const value = input instanceof Request ? input.url : input.toString();
    const url = new URL(value, baseUrl);
    let path = url.pathname;
    try {
        path = decodeURIComponent(path);
    } catch {
        path = url.pathname;
    }
    return { url, path };
}

function classify(method: string, url: URL, haystack: string): TrialRequestCategory {
    const queryNames = [...url.searchParams.keys()].map(key => key.toLowerCase());
    if (queryNames.some(key => key.startsWith("eppo_"))) return "staff-override";
    if (PASSIVE_METHODS.has(method)) {
        if (OAUTH_PATTERN.test(haystack) && (CONNECTOR_MARKER_PATTERN.test(haystack) || queryNames.some(key => CONNECTOR_MARKER_PATTERN.test(key)))) return "connector-oauth";
        return "passive-read";
    }
    if (TELEMETRY_PATTERN.test(url.pathname.toLowerCase())) return "telemetry";
    if (OAUTH_PATTERN.test(haystack)) return "connector-oauth";
    if (method === "DELETE" || DELETE_PATTERN.test(haystack)) return "delete";
    if (CHECKOUT_PATTERN.test(haystack) || /(^|\.)stripe\.com$|(^|\.)paypal\.com$/.test(url.hostname)) return "checkout";
    if (BILLING_PATTERN.test(haystack)) return "billing";
    if (PLUGIN_PATTERN.test(haystack)) return "plugin-mutation";
    if (UPLOAD_PATTERN.test(haystack)) return "upload";
    if (SHARE_PATTERN.test(haystack)) return "share";
    if (ACCOUNT_PATTERN.test(haystack)) return "account-switch";
    if (COMPLETION_PATTERN.test(haystack)) return "completion";
    return "unknown-mutation";
}

export function classifyTrialRequest(input: TrialRequestInput): TrialRequestDecision {
    const method = (input.method ?? (input.url instanceof Request ? input.url.method : "GET")).toUpperCase();
    const { url, path } = normalizeUrl(input.url, input.baseUrl);
    const headers = new Headers(input.headers ?? (input.url instanceof Request ? input.url.headers : undefined));
    const { bodyBytes, bodyKeys, bodyText } = inspectBody(input.body);
    const haystack = `${path.toLowerCase()} ${bodyKeys.join(" ").toLowerCase()} ${bodyText}`;
    const category = classify(method, url, haystack);
    const blocked = category !== "passive-read" && category !== "telemetry";
    return {
        blocked,
        category,
        evidence: {
            site: input.site,
            category,
            method,
            origin: url.origin,
            path,
            queryNames: [...url.searchParams.keys()].toSorted(),
            contentType: headers.get("content-type") ?? "",
            bodyBytes,
            bodyKeys,
            blocked,
        },
    };
}

export class TrialRequestBlockedError extends Error {
    constructor(readonly evidence: BlockedRequestEvidence) {
        super(`Trial request blocked: ${evidence.category}`);
        this.name = "TrialRequestBlockedError";
    }
}

export function createTrialFetch(options: TrialFetchOptions): TrialFetch {
    return async (input, init) => {
        const decision = classifyTrialRequest({
            site: options.site,
            method: init?.method,
            url: input,
            baseUrl: options.baseUrl,
            headers: init?.headers,
            body: init?.body,
        });
        if (!decision.blocked) return options.fetchImpl(input, init);
        const evidence = { ...decision.evidence, trialId: options.trialId };
        options.onBlocked(evidence);
        throw new TrialRequestBlockedError(evidence);
    };
}
