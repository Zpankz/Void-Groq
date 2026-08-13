/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { classifyTrialRequest } from "./NetworkPolicy";
import { evaluateWrite } from "./Policy";
import { REDACTED,redactValue } from "./Redaction";
import { evaluatePromotion, runScenario, SCENARIO_IDS, type ScenarioDefinition } from "./Scenarios";

const definitions = [
    { id: SCENARIO_IDS.GROK_WORKSPACE_AGENT_POLICY, expectedStatus: "implemented", expectedObservableIds: ["policy.allowed"], safety: "client-local" },
    { id: SCENARIO_IDS.BLOCK_COMPLETION_REQUEST, expectedStatus: "blocked", expectedObservableIds: ["request.category"], safety: "read-only" },
    { id: SCENARIO_IDS.GEMINI_FEATURE_WRITE, expectedStatus: "unsupported", expectedObservableIds: ["policy.reason"], safety: "read-only" },
] as const satisfies readonly ScenarioDefinition[];

describe("runScenario", () => {
    test("links implemented observables to a stable evidence packet", async () => {
        const outcome = await runScenario(definitions[0], "packet-policy-1", () => {
            const decision = evaluateWrite({ site: "grok", capability: "feature-override", key: "workspace_agent" });
            return { status: "implemented", observables: [{ id: "policy.allowed", kind: "policy-decision", value: decision.allowed }] };
        });
        expect(outcome).toEqual({
            scenarioId: "policy.grok.workspace-agent.v1",
            evidencePacketId: "packet-policy-1",
            status: "implemented",
            observables: [{ id: "policy.allowed", kind: "policy-decision", value: true }],
        });
    });

    test("represents expected network blocking explicitly", async () => {
        const outcome = await runScenario(definitions[1], "packet-network-1", () => {
            const decision = classifyTrialRequest({ site: "grok", method: "POST", url: "/backend-api/conversation", baseUrl: "https://grok.com/" });
            return { status: "blocked", observables: [{ id: "request.category", kind: "request-block", value: decision.category }] };
        });
        expect(outcome.status).toBe("blocked");
        expect(outcome.observables).toHaveLength(1);
    });

    test("represents observe-only capabilities as unsupported", async () => {
        const outcome = await runScenario(definitions[2], "packet-observe-1", () => {
            const decision = evaluateWrite({ site: "gemini", capability: "feature-override", key: "fake_flag" });
            return { status: "unsupported", observables: [{ id: "policy.reason", kind: "policy-decision", value: decision.reason }] };
        });
        expect(outcome).toMatchObject({ status: "unsupported", observables: [{ value: "observe-only" }] });
    });

    test("redacts evidence before it becomes an observable", async () => {
        const definition = { id: SCENARIO_IDS.REDACT_EVIDENCE, expectedStatus: "implemented", expectedObservableIds: ["redaction.output"], safety: "read-only" } as const;
        const outcome = await runScenario(definition, "packet-redaction-1", () => {
            const redacted = redactValue({ token: "fake-token", safe: 1 });
            return { status: "implemented", observables: [{ id: "redaction.output", kind: "redaction", value: JSON.stringify(redacted.value) }] };
        });
        expect(JSON.stringify(outcome)).not.toContain("fake-token");
        expect(outcome.observables).toHaveLength(1);
    });

    test("normalizes absent, empty, and failed executors to missing", async () => {
        await expect(runScenario(definitions[0], "packet-missing-1")).resolves.toMatchObject({ status: "missing", observables: [] });
        await expect(runScenario(definitions[0], "packet-empty-1", () => ({ status: "implemented", observables: [] }))).resolves.toMatchObject({ status: "missing", observables: [] });
        await expect(runScenario(definitions[0], "packet-error-1", () => { throw new Error("fixture failure"); })).resolves.toMatchObject({ status: "missing", observables: [] });
    });
});

describe("evaluatePromotion", () => {
    test("passes only when every required scenario has its expected observable outcome", async () => {
        const outcomes = await Promise.all([
            runScenario(definitions[0], "packet-1", () => ({ status: "implemented", observables: [{ id: "policy.allowed", kind: "policy-decision", value: true }] })),
            runScenario(definitions[1], "packet-2", () => ({ status: "blocked", observables: [{ id: "request.category", kind: "request-block", value: "completion" }] })),
            runScenario(definitions[2], "packet-3", () => ({ status: "unsupported", observables: [{ id: "policy.reason", kind: "policy-decision", value: "observe-only" }] })),
        ]);
        expect(evaluatePromotion(definitions, outcomes)).toEqual({ promotable: true, failures: [] });
    });

    test("fails promotion for missing, empty, mismatched, or unlinked scenarios", () => {
        const result = evaluatePromotion(definitions, [
            { scenarioId: definitions[0].id, evidencePacketId: "packet-1", status: "missing", observables: [] },
            { scenarioId: definitions[1].id, evidencePacketId: "packet-2", status: "implemented", observables: [{ id: "wrong", kind: "request-block", value: true }] },
            { scenarioId: definitions[2].id, evidencePacketId: "", status: "unsupported", observables: [{ id: "policy.reason", kind: "policy-decision", value: "observe-only" }] },
        ]);
        expect(result.promotable).toBeFalse();
        expect(result.failures.map(failure => failure.reason)).toEqual(["missing", "status-mismatch", "unlinked"]);
    });

    test("fails promotion for no observables, wrong observable IDs, duplicates, and unexpected outcomes", () => {
        const result = evaluatePromotion(definitions, [
            { scenarioId: definitions[0].id, evidencePacketId: "packet-1", status: "implemented", observables: [] },
            { scenarioId: definitions[1].id, evidencePacketId: "packet-2", status: "blocked", observables: [{ id: "wrong", kind: "request-block", value: "completion" }] },
            { scenarioId: definitions[1].id, evidencePacketId: "packet-3", status: "blocked", observables: [{ id: "request.category", kind: "request-block", value: "completion" }] },
            { scenarioId: definitions[2].id, evidencePacketId: "packet-4", status: "unsupported", observables: [{ id: "policy.reason", kind: "policy-decision", value: "observe-only" }] },
            { scenarioId: SCENARIO_IDS.REDACT_EVIDENCE, evidencePacketId: "packet-extra", status: "implemented", observables: [{ id: "redaction.output", kind: "redaction", value: REDACTED }] },
        ]);
        expect(result.promotable).toBeFalse();
        expect(result.failures.map(failure => failure.reason)).toEqual(["unexpected", "no-observables", "duplicate"]);
    });

    test("fails promotion when required observable identity changes", () => {
        const result = evaluatePromotion([definitions[0]], [
            { scenarioId: definitions[0].id, evidencePacketId: "packet-1", status: "implemented", observables: [{ id: "policy.changed", kind: "policy-decision", value: true }] },
        ]);
        expect(result.failures).toEqual([{ scenarioId: definitions[0].id, reason: "observable-mismatch" }]);
    });
});
