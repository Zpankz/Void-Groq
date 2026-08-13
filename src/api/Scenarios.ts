/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SCENARIO_IDS = {
    GROK_WORKSPACE_AGENT_POLICY: "policy.grok.workspace-agent.v1",
    BLOCK_COMPLETION_REQUEST: "network.block-completion.v1",
    GEMINI_FEATURE_WRITE: "policy.gemini.observe-only.v1",
    REDACT_EVIDENCE: "evidence.redaction.v1",
} as const;

export type ScenarioId = typeof SCENARIO_IDS[keyof typeof SCENARIO_IDS];
export type ScenarioStatus = "missing" | "implemented" | "blocked" | "unsupported";
export type ScenarioSafety = "client-local" | "read-only" | "dom-augmentation";

export interface ScenarioDefinition {
    id: ScenarioId;
    expectedStatus: Exclude<ScenarioStatus, "missing">;
    expectedObservableIds: readonly string[];
    safety: ScenarioSafety;
}

export interface ScenarioObservable {
    id: string;
    kind: "policy-decision" | "request-block" | "redaction" | "dom" | "store-readback" | "patch-report";
    value: boolean | number | string;
}

export interface ScenarioResult {
    status: ScenarioStatus;
    observables: ScenarioObservable[];
}

export interface ScenarioOutcome extends ScenarioResult {
    scenarioId: ScenarioId;
    evidencePacketId: string;
}

export interface PromotionFailure {
    scenarioId: ScenarioId;
    reason: "missing" | "no-observables" | "status-mismatch" | "observable-mismatch" | "duplicate" | "unlinked" | "unexpected";
}

export type ScenarioExecutor = () => ScenarioResult | Promise<ScenarioResult>;

export async function runScenario(definition: ScenarioDefinition, evidencePacketId: string, execute?: ScenarioExecutor): Promise<ScenarioOutcome> {
    if (!execute) return { scenarioId: definition.id, evidencePacketId, status: "missing", observables: [] };
    try {
        const result = await execute();
        if (!result.observables.length) return { scenarioId: definition.id, evidencePacketId, status: "missing", observables: [] };
        return { scenarioId: definition.id, evidencePacketId, ...result };
    } catch {
        return { scenarioId: definition.id, evidencePacketId, status: "missing", observables: [] };
    }
}

export function evaluatePromotion(required: readonly ScenarioDefinition[], outcomes: readonly ScenarioOutcome[]) {
    const failures: PromotionFailure[] = [];
    const requiredIds = new Set(required.map(definition => definition.id));
    for (const outcome of outcomes) {
        if (!requiredIds.has(outcome.scenarioId)) failures.push({ scenarioId: outcome.scenarioId, reason: "unexpected" });
    }
    for (const definition of required) {
        const matches = outcomes.filter(outcome => outcome.scenarioId === definition.id);
        if (!matches.length) {
            failures.push({ scenarioId: definition.id, reason: "missing" });
            continue;
        }
        if (matches.length > 1) {
            failures.push({ scenarioId: definition.id, reason: "duplicate" });
            continue;
        }
        const [outcome] = matches;
        if (!outcome.evidencePacketId) failures.push({ scenarioId: definition.id, reason: "unlinked" });
        else if (!outcome.observables.length) failures.push({ scenarioId: definition.id, reason: outcome.status === "missing" ? "missing" : "no-observables" });
        else if (outcome.status !== definition.expectedStatus) failures.push({ scenarioId: definition.id, reason: "status-mismatch" });
        else if (definition.expectedObservableIds.some(id => !outcome.observables.some(observable => observable.id === id))) failures.push({ scenarioId: definition.id, reason: "observable-mismatch" });
    }
    return { promotable: !failures.length, failures };
}
