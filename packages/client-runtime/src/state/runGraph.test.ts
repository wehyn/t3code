import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import { v2Now, v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { deriveRunGraph } from "./runGraph.ts";

const THREAD_ID = v2ThreadId;
const PROVIDER_ID = ProviderInstanceId.make("codex");
const RUN_ID = RunId.make("run-graph-run");
const ATTEMPT_ID = RunAttemptId.make("run-graph-attempt");
const ROOT_ID = NodeId.make("run-graph-root");

function run(overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run {
  return {
    id: RUN_ID,
    threadId: THREAD_ID,
    ordinal: 1,
    providerInstanceId: PROVIDER_ID,
    modelSelection: { instanceId: PROVIDER_ID, model: "gpt-5.4" },
    providerThreadId: null,
    userMessageId: MessageId.make("run-graph-user-message"),
    rootNodeId: ROOT_ID,
    activeAttemptId: ATTEMPT_ID,
    status: "waiting",
    requestedAt: v2Now,
    startedAt: v2Now,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
    ...overrides,
  };
}

function rootNode(overrides: Partial<OrchestrationV2ExecutionNode> = {}) {
  return executionNode({
    id: ROOT_ID,
    kind: "root_turn",
    parentNodeId: null,
    status: "waiting",
    ...overrides,
  });
}

function executionNode(
  overrides: Partial<OrchestrationV2ExecutionNode> = {},
): OrchestrationV2ExecutionNode {
  const id = overrides.id ?? NodeId.make("run-graph-node");
  return {
    id,
    threadId: THREAD_ID,
    runId: RUN_ID,
    parentNodeId: ROOT_ID,
    rootNodeId: ROOT_ID,
    kind: "tool_call",
    status: "running",
    countsForRun: true,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    runtimeRequestId: null,
    checkpointScopeId: null,
    startedAt: v2Now,
    completedAt: null,
    ...overrides,
  };
}

function attempt(): OrchestrationV2RunAttempt {
  return {
    id: ATTEMPT_ID,
    runId: RUN_ID,
    attemptOrdinal: 1,
    rootNodeId: ROOT_ID,
    providerInstanceId: PROVIDER_ID,
    providerThreadId: ProviderThreadId.make("run-graph-provider-thread"),
    providerTurnId: null,
    reason: "initial",
    status: "completed",
    startedAt: v2Now,
    completedAt: v2Now,
  };
}

function commandItem(
  id: string,
  nodeId: NodeId | null,
  overrides: Partial<Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }>> = {},
): Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }> {
  return {
    type: "command_execution",
    id: TurnItemId.make(id),
    threadId: THREAD_ID,
    runId: RUN_ID,
    nodeId,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: v2Now,
    completedAt: v2Now,
    updatedAt: v2Now,
    input: "pnpm test",
    ...overrides,
  };
}

function pendingRequest(nodeId: NodeId): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make("run-graph-request"),
    nodeId,
    providerTurnId: null,
    nativeRequestRef: null,
    kind: "command",
    status: "pending",
    responseCapability: { type: "message" },
    createdAt: v2Now,
    resolvedAt: null,
  };
}

function subagent(
  id: NodeId,
  overrides: Partial<OrchestrationV2Subagent> = {},
): OrchestrationV2Subagent {
  return {
    id,
    threadId: THREAD_ID,
    runId: RUN_ID,
    parentNodeId: ROOT_ID,
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: PROVIDER_ID,
    providerThreadId: null,
    childThreadId: ThreadId.make("run-graph-child-thread"),
    nativeTaskRef: null,
    prompt: "Check the tests",
    title: "Test agent",
    model: "gpt-5.4",
    status: "running",
    result: null,
    startedAt: v2Now,
    completedAt: null,
    updatedAt: v2Now,
    ...overrides,
  };
}

function projection(overrides: Partial<OrchestrationV2ThreadProjection> = {}) {
  return {
    ...v2Projection,
    runs: [run()],
    attempts: [attempt()],
    nodes: [rootNode()],
    ...overrides,
  };
}

function graph(overrides: Partial<OrchestrationV2ThreadProjection> = {}) {
  return deriveRunGraph({ projection: projection(overrides), runId: RUN_ID });
}

describe("deriveRunGraph", () => {
  it("reparents visible activity around a rolled-back parent", () => {
    const rolledBackId = NodeId.make("run-graph-rolled-back");
    const visibleTool = executionNode({
      id: NodeId.make("run-graph-visible-tool"),
      parentNodeId: rolledBackId,
    });

    const result = graph({
      nodes: [
        rootNode(),
        executionNode({ id: rolledBackId, kind: "assistant_message", status: "rolled_back" }),
        visibleTool,
      ],
    });

    expect(result.nodes.map((node) => node.sourceNodeId)).not.toContain(rolledBackId);
    expect(result.edges).toEqual([
      {
        from: result.nodes[0]!.key,
        to: result.nodes.find((node) => node.sourceNodeId === visibleTool.id)!.key,
      },
    ]);
  });

  it("connects activity with a missing parent to the run root", () => {
    const orphan = executionNode({
      id: NodeId.make("run-graph-orphan"),
      parentNodeId: NodeId.make("missing-parent"),
    });

    const result = graph({ nodes: [rootNode(), orphan] });

    expect(result.edges).toEqual([{ from: result.nodes[0]!.key, to: result.nodes[1]!.key }]);
  });

  it("does not attribute a pending request outside the selected run", () => {
    const otherRunId = RunId.make("run-graph-other-run");
    const otherNode = executionNode({
      id: NodeId.make("run-graph-other-node"),
      runId: otherRunId,
      kind: "approval_request",
      status: "waiting",
    });

    const result = graph({
      nodes: [rootNode(), otherNode],
      runtimeRequests: [pendingRequest(otherNode.id)],
    });

    expect(result.nodes.some((node) => node.state === "needs_you")).toBe(false);
    expect(result.summary.needsYouCount).toBe(0);
  });

  it("marks an in-scope pending approval as needing the user", () => {
    const approval = executionNode({
      id: NodeId.make("run-graph-approval"),
      kind: "approval_request",
      status: "waiting",
    });

    const result = graph({
      nodes: [rootNode(), approval],
      runtimeRequests: [pendingRequest(approval.id)],
    });

    expect(result.nodes.find((node) => node.sourceNodeId === approval.id)).toMatchObject({
      kind: "activity",
      activityKind: "approval",
      state: "needs_you",
      statusLabel: "Needs you",
    });
    expect(result.summary.needsYouCount).toBe(1);
  });

  it("resolves a waiting run and root from its completed provider turn", () => {
    const completedAt = DateTime.makeUnsafe("2026-06-20T00:02:00.000Z");
    const providerTurn = {
      id: ProviderTurnId.make("run-graph-provider-turn"),
      providerThreadId: ProviderThreadId.make("run-graph-provider-thread"),
      nodeId: ROOT_ID,
      runAttemptId: ATTEMPT_ID,
      nativeTurnRef: null,
      ordinal: 1,
      status: "completed",
      startedAt: v2Now,
      completedAt,
    } satisfies OrchestrationV2ThreadProjection["providerTurns"][number];

    const result = graph({
      nodes: [rootNode({ completedAt: DateTime.makeUnsafe("2026-06-20T00:03:00.000Z") })],
      providerTurns: [providerTurn],
    });

    expect(result.nodes[0]?.state).toBe("answer");
    expect(result.nodes[0]?.statusLabel).toBe("Completed");
    expect(result.nodes[0]?.completedAt).toBe(completedAt);
  });

  it("resolves a waiting root when the run is explicitly completed", () => {
    const result = graph({ runs: [run({ status: "completed" })] });

    expect(result.nodes[0]?.state).toBe("answer");
  });

  it("shows subagent records with or without a matching execution node", () => {
    const recordedAgentId = NodeId.make("run-graph-recorded-agent");
    const unlinkedAgentId = NodeId.make("run-graph-unlinked-agent");
    const recordedAgent = subagent(recordedAgentId);
    const unlinkedAgent = subagent(unlinkedAgentId, {
      parentNodeId: NodeId.make("missing-parent"),
      title: "Unlinked agent",
    });
    const subagentNode = executionNode({
      id: recordedAgentId,
      kind: "subagent",
      status: "running",
    });

    const result = graph({
      nodes: [rootNode(), subagentNode],
      subagents: [recordedAgent, unlinkedAgent],
    });

    expect(result.nodes.filter((node) => node.kind === "agent")).toHaveLength(3);
    expect(result.nodes.find((node) => node.sourceNodeId === recordedAgentId)).toMatchObject({
      kind: "agent",
      label: "Test agent",
      prompt: "Check the tests",
      childThreadId: recordedAgent.childThreadId,
    });
    expect(result.nodes.find((node) => node.sourceNodeId === unlinkedAgentId)).toMatchObject({
      kind: "agent",
      label: "Unlinked agent",
      parentKey: result.nodes[0]!.key,
    });
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "stopped"],
    ["interrupted", "stopped"],
  ] as const)("maps %s execution work to %s", (status, expected) => {
    const result = graph({
      nodes: [rootNode(), executionNode({ status })],
    });

    expect(result.nodes[1]?.state).toBe(expected);
    expect(result.nodes[1]?.statusLabel).toBe(
      status === "cancelled" ? "Cancelled" : status[0]!.toUpperCase() + status.slice(1),
    );
    expect(result.summary.failedCount).toBe(status === "failed" ? 1 : 0);
    expect(result.summary.stoppedCount).toBe(status === "failed" ? 0 : 1);
  });

  it("keeps an unmatched command item as a synthetic activity", () => {
    const item = commandItem("run-graph-unmatched-item", null, { input: "git status" });
    const itemWithMissingNode = commandItem(
      "run-graph-item-with-missing-node",
      NodeId.make("missing-node"),
    );

    const result = graph({ turnItems: [item, itemWithMissingNode] });
    const activity = result.nodes.find((node) => node.kind === "activity");

    expect(activity).toMatchObject({
      kind: "activity",
      activityKind: "tool",
      sourceNodeId: null,
      label: "git status",
      turnItemIds: [item.id],
    });
    expect(result.edges).toEqual(
      result.nodes
        .filter((node) => node.kind === "activity")
        .map((node) => ({ from: result.nodes[0]!.key, to: node.key })),
    );
  });

  it("counts distinct linked tool items and an unlinked execution node once", () => {
    const firstTool = executionNode({ id: NodeId.make("run-graph-first-tool") });
    const secondTool = executionNode({ id: NodeId.make("run-graph-second-tool") });
    const firstItem = commandItem("run-graph-first-item", firstTool.id);
    const secondItem = commandItem("run-graph-second-item", firstTool.id, { ordinal: 2 });

    const result = graph({
      nodes: [rootNode(), firstTool, secondTool],
      turnItems: [firstItem, secondItem, firstItem],
    });

    expect(result.summary.toolCallCount).toBe(3);
    expect(result.nodes.find((node) => node.sourceNodeId === firstTool.id)).toMatchObject({
      kind: "activity",
      turnItemIds: [firstItem.id, secondItem.id],
    });
  });

  it("keeps a tool execution visible when its turn item is not in the projection", () => {
    const tool = executionNode({ id: NodeId.make("run-graph-missing-item-tool") });

    const result = graph({ nodes: [rootNode(), tool] });

    expect(result.nodes.find((node) => node.sourceNodeId === tool.id)).toMatchObject({
      kind: "activity",
      label: "Tool call",
      turnItemIds: [],
    });
    expect(result.summary.toolCallCount).toBe(1);
    expect(result.summary.agentCount).toBe(1);
  });

  it("limits an output failure hint to its linked command activity", () => {
    const tool = executionNode({ id: NodeId.make("run-graph-command-tool") });
    const item = commandItem("run-graph-failed-command", tool.id, {
      outputIndicatesFailure: true,
    });

    const result = graph({ nodes: [rootNode(), tool], turnItems: [item] });

    expect(result.nodes[0]?.state).toBe("call");
    expect(result.nodes[0]?.statusLabel).toBe("Waiting");
    expect(result.nodes.find((node) => node.sourceNodeId === tool.id)).toMatchObject({
      kind: "activity",
      state: "failed",
      statusLabel: "Output indicates failure",
    });
    expect(result.summary.failedCount).toBe(1);
  });
});
