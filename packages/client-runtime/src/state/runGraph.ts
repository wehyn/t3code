import {
  latestProviderTurnForAttempt,
  type NodeId,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { ThreadStructure, ThreadStructureTurnItem } from "./models.ts";

export type RunGraphState = "call" | "answer" | "needs_you" | "failed" | "stopped";

export type RunGraphNodeKey = string & { readonly __brand: "RunGraphNodeKey" };

export type RunGraphNode =
  | {
      readonly key: RunGraphNodeKey;
      readonly threadId: ThreadId;
      readonly kind: "agent";
      readonly sourceNodeId: NodeId | null;
      readonly parentKey: RunGraphNodeKey | null;
      readonly state: RunGraphState;
      readonly statusLabel: string;
      readonly label: string;
      readonly providerInstanceId: ProviderInstanceId | null;
      readonly model: string | null;
      readonly prompt: string | null;
      readonly progress: string | null;
      readonly result: string | null;
      readonly childThreadId: ThreadId | null;
      readonly startedAt: DateTime.Utc | null;
      readonly completedAt: DateTime.Utc | null;
    }
  | {
      readonly key: RunGraphNodeKey;
      readonly threadId: ThreadId;
      readonly kind: "activity";
      readonly activityKind: "tool" | "approval" | "question";
      readonly sourceNodeId: NodeId | null;
      readonly parentKey: RunGraphNodeKey | null;
      readonly state: RunGraphState;
      readonly statusLabel: string;
      readonly label: string;
      readonly turnItemIds: ReadonlyArray<TurnItemId>;
      readonly errorItemIds: ReadonlyArray<TurnItemId>;
      readonly runtimeRequestIds: ReadonlyArray<RuntimeRequestId>;
      readonly startedAt: DateTime.Utc | null;
      readonly completedAt: DateTime.Utc | null;
    };

export interface RunGraph {
  readonly runId: RunId;
  readonly nodes: ReadonlyArray<RunGraphNode>;
  readonly edges: ReadonlyArray<RunGraphEdge>;
  readonly summary: {
    readonly agentCount: number;
    readonly toolCallCount: number;
    readonly needsYouCount: number;
    readonly failedCount: number;
    readonly stoppedCount: number;
    readonly observedStartedAt: DateTime.Utc | null;
    readonly observedCompletedAt: DateTime.Utc | null;
  };
}

type RunGraphEdge = {
  readonly from: RunGraphNodeKey;
  readonly to: RunGraphNodeKey;
};

type RunStatus = OrchestrationV2Run["status"];
type NodeStatus = OrchestrationV2ExecutionNode["status"];
type TurnItemStatus = OrchestrationV2TurnItem["status"];
type GraphSourceStatus = RunStatus | NodeStatus | TurnItemStatus;
type RuntimeRequestKind = OrchestrationV2ThreadProjection["runtimeRequests"][number]["kind"];

const STATUS_PRESENTATION = {
  preparing: { state: "call", label: "Preparing" },
  queued: { state: "call", label: "Queued" },
  starting: { state: "call", label: "Starting" },
  idle: { state: "call", label: "Idle" },
  pending: { state: "call", label: "Pending" },
  running: { state: "call", label: "Running" },
  waiting: { state: "call", label: "Waiting" },
  completed: { state: "answer", label: "Completed" },
  interrupted: { state: "stopped", label: "Interrupted" },
  cancelled: { state: "stopped", label: "Cancelled" },
  rolled_back: { state: "stopped", label: "Rolled back" },
  failed: { state: "failed", label: "Failed" },
} as const satisfies Record<
  GraphSourceStatus,
  { readonly state: RunGraphState; readonly label: string }
>;

const REQUEST_KIND_IS_INTERACTIVE = {
  command: true,
  "file-read": true,
  "file-change": true,
  "mcp-elicitation": true,
  permission: true,
  dynamic_tool_call: false,
  user_input: true,
  auth_refresh: false,
} as const satisfies Record<RuntimeRequestKind, boolean>;

type ToolItem = ThreadStructureTurnItem & {
  readonly type:
    | "command_execution"
    | "dynamic_tool"
    | "file_change"
    | "file_search"
    | "web_search";
};

type ActivityExecutionNode = OrchestrationV2ExecutionNode & {
  readonly kind: "tool_call" | "approval_request" | "user_input_request";
};

function isToolItem(item: ThreadStructureTurnItem): item is ToolItem {
  switch (item.type) {
    case "command_execution":
    case "dynamic_tool":
    case "file_change":
    case "file_search":
    case "web_search":
      return true;
    default:
      return false;
  }
}

function isRunGraphNodeKey(value: string): value is RunGraphNodeKey {
  return /^run-graph:(agent|activity-node|activity-item|root):[^:]+:[^:]+$/.test(value);
}

function graphKey(
  namespace: "agent" | "activity-node" | "activity-item" | "root",
  threadId: ThreadId,
  sourceId: string,
): RunGraphNodeKey {
  const value = `run-graph:${namespace}:${encodeURIComponent(threadId)}:${encodeURIComponent(sourceId)}`;
  if (!isRunGraphNodeKey(value)) throw new Error("Invalid run graph node key");
  return value;
}

function latestTimestamp(timestamps: ReadonlyArray<DateTime.Utc | null>): DateTime.Utc | null {
  return timestamps.reduce<DateTime.Utc | null>(
    (latest, timestamp) =>
      timestamp !== null && (latest === null || timestamp > latest) ? timestamp : latest,
    null,
  );
}

function earliestTimestamp(timestamps: ReadonlyArray<DateTime.Utc | null>): DateTime.Utc | null {
  return timestamps.reduce<DateTime.Utc | null>(
    (earliest, timestamp) =>
      timestamp !== null && (earliest === null || timestamp < earliest) ? timestamp : earliest,
    null,
  );
}

function toolLabel(item: ToolItem | undefined): string {
  if (item === undefined) return "Tool call";
  switch (item.type) {
    case "command_execution":
      return item.input.trim() || "Command";
    case "dynamic_tool":
      return item.toolName ?? "Tool call";
    case "file_change": {
      const changes = item.changes;
      const firstPath = changes?.[0]?.path ?? item.fileName;
      return changes !== undefined && changes.length > 1
        ? `${firstPath} +${changes.length - 1} more`
        : firstPath;
    }
    case "file_search":
      return item.pattern ?? "File search";
    case "web_search":
      return item.patterns?.join(", ") || "Web search";
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

function isActivityNode(node: OrchestrationV2ExecutionNode): node is ActivityExecutionNode {
  return (
    node.kind === "tool_call" ||
    node.kind === "approval_request" ||
    node.kind === "user_input_request"
  );
}

function activityKind(node: ActivityExecutionNode): "tool" | "approval" | "question" {
  if (node.kind === "tool_call") return "tool";
  if (node.kind === "approval_request") return "approval";
  return "question";
}

function nodeLabel(node: ActivityExecutionNode, items: ReadonlyArray<ToolItem>): string {
  if (node.kind === "tool_call") return toolLabel(items[0]);
  if (node.kind === "approval_request") return "Approval request";
  return "User input";
}

function nearestVisibleParentKey(
  parentNodeId: NodeId | null,
  nodeById: ReadonlyMap<NodeId, OrchestrationV2ExecutionNode>,
  visibleNodeKeys: ReadonlyMap<NodeId, RunGraphNodeKey>,
  rootKey: RunGraphNodeKey,
): RunGraphNodeKey {
  const visited = new Set<NodeId>();
  let parentId = parentNodeId;
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const visibleKey = visibleNodeKeys.get(parentId);
    if (visibleKey !== undefined) return visibleKey;
    parentId = nodeById.get(parentId)?.parentNodeId ?? null;
  }
  return rootKey;
}

function itemIdsByNode(
  items: ReadonlyArray<ThreadStructureTurnItem>,
  nodesById: ReadonlyMap<NodeId, OrchestrationV2ExecutionNode>,
): Map<NodeId, ThreadStructureTurnItem[]> {
  const result = new Map<NodeId, ThreadStructureTurnItem[]>();
  for (const item of items) {
    if (item.nodeId === null || !nodesById.has(item.nodeId)) continue;
    const linked = result.get(item.nodeId) ?? [];
    if (linked.some((candidate) => candidate.id === item.id)) continue;
    linked.push(item);
    result.set(item.nodeId, linked);
  }
  return result;
}

function interactiveRequest(
  request: OrchestrationV2ThreadProjection["runtimeRequests"][number],
): boolean {
  return REQUEST_KIND_IS_INTERACTIVE[request.kind];
}

export function deriveRunGraph(input: {
  readonly projection: ThreadStructure;
  readonly runId: RunId;
}): RunGraph {
  const { projection, runId } = input;
  const run = projection.runs.find((candidate) => candidate.id === runId);
  if (run === undefined) {
    return {
      runId,
      nodes: [],
      edges: [],
      summary: {
        agentCount: 0,
        toolCallCount: 0,
        needsYouCount: 0,
        failedCount: 0,
        stoppedCount: 0,
        observedStartedAt: null,
        observedCompletedAt: null,
      },
    };
  }

  const runNodes = projection.nodes.filter((node) => node.runId === runId);
  const visibleExecutionNodes = runNodes.filter(
    (node) =>
      node.status !== "rolled_back" &&
      (node.kind === "root_turn" || node.kind === "subagent" || isActivityNode(node)),
  );
  const nodeById = new Map(runNodes.map((node) => [node.id, node]));
  const visibleNodeKeys = new Map<NodeId, RunGraphNodeKey>();
  const rootExecutionNode =
    (run.rootNodeId === null
      ? undefined
      : visibleExecutionNodes.find((node) => node.id === run.rootNodeId)) ??
    visibleExecutionNodes.find((node) => node.kind === "root_turn");
  const rootKey =
    rootExecutionNode === undefined
      ? graphKey("root", projection.thread.id, run.id)
      : graphKey("agent", projection.thread.id, rootExecutionNode.id);
  for (const node of visibleExecutionNodes) {
    visibleNodeKeys.set(
      node.id,
      node.kind === "root_turn"
        ? rootKey
        : node.kind === "subagent"
          ? graphKey("agent", projection.thread.id, node.id)
          : graphKey("activity-node", projection.thread.id, node.id),
    );
  }

  const items = projection.turnItems;
  const linkedItemsByNode = itemIdsByNode(items, nodeById);
  const requestsByNode = new Map<NodeId, typeof projection.runtimeRequests>();
  for (const request of projection.runtimeRequests) {
    if (nodeById.get(request.nodeId)?.runId !== runId) continue;
    const linked = requestsByNode.get(request.nodeId) ?? [];
    requestsByNode.set(request.nodeId, [...linked, request]);
  }
  const errorsByNode = new Map<NodeId, TurnItemId[]>();
  for (const item of items) {
    if (item.type !== "error" || item.nodeId === null || nodeById.get(item.nodeId)?.runId !== runId)
      continue;
    const linked = errorsByNode.get(item.nodeId) ?? [];
    linked.push(item.id);
    errorsByNode.set(item.nodeId, linked);
  }

  const subagentById = new Map(projection.subagents.map((subagent) => [subagent.id, subagent]));
  const providerTurn = latestProviderTurnForAttempt(projection.providerTurns, run.activeAttemptId);
  const completedTurn = providerTurn?.status === "completed";
  const completedTurnAt = completedTurn ? providerTurn.completedAt : null;
  const nodes: RunGraphNode[] = [];
  const edges: RunGraphEdge[] = [];

  const rootStatus =
    rootExecutionNode?.status === "waiting" &&
    (run.status === "completed" || (run.status === "waiting" && completedTurn))
      ? "completed"
      : run.status === "failed" ||
          run.status === "interrupted" ||
          run.status === "cancelled" ||
          run.status === "rolled_back"
        ? run.status
        : (rootExecutionNode?.status ?? run.status);
  const rootPresentation = STATUS_PRESENTATION[rootStatus];
  const rootAgent: RunGraphNode = {
    key: rootKey,
    threadId: projection.thread.id,
    kind: "agent",
    sourceNodeId: rootExecutionNode?.id ?? null,
    parentKey: null,
    state: rootPresentation.state,
    statusLabel: rootPresentation.label,
    label: "Main agent",
    providerInstanceId: run.providerInstanceId,
    model: run.modelSelection.model,
    prompt: null,
    progress: null,
    result: null,
    childThreadId: null,
    startedAt: rootExecutionNode?.startedAt ?? run.startedAt,
    completedAt: completedTurnAt ?? rootExecutionNode?.completedAt ?? run.completedAt,
  };
  nodes.push(rootAgent);

  const includedSubagents = new Set<NodeId>();
  for (const node of visibleExecutionNodes) {
    if (node.kind !== "subagent" || node.id === rootExecutionNode?.id) continue;
    const subagent = subagentById.get(node.id);
    includedSubagents.add(node.id);
    const presentation = STATUS_PRESENTATION[subagent?.status ?? node.status];
    const key = visibleNodeKeys.get(node.id);
    if (key === undefined) continue;
    const parentKey = nearestVisibleParentKey(
      node.parentNodeId,
      nodeById,
      visibleNodeKeys,
      rootKey,
    );
    nodes.push({
      key,
      threadId: projection.thread.id,
      kind: "agent",
      sourceNodeId: node.id,
      parentKey,
      state: presentation.state,
      statusLabel: presentation.label,
      label: subagent?.title || "Subagent",
      providerInstanceId: subagent?.providerInstanceId ?? null,
      model: subagent?.model ?? null,
      prompt: subagent?.prompt ?? null,
      progress: subagent?.progress ?? null,
      result: subagent?.result ?? null,
      childThreadId: subagent?.childThreadId ?? null,
      startedAt: subagent?.startedAt ?? node.startedAt,
      completedAt: subagent?.completedAt ?? node.completedAt,
    });
    edges.push({ from: parentKey, to: key });
  }

  for (const subagent of projection.subagents) {
    if (includedSubagents.has(subagent.id)) continue;
    const parentNode = nodeById.get(subagent.parentNodeId);
    if (parentNode?.status === "rolled_back") continue;
    if (subagent.runId !== runId && parentNode?.runId !== runId) continue;
    const key = graphKey("agent", projection.thread.id, subagent.id);
    const parentKey = nearestVisibleParentKey(
      subagent.parentNodeId,
      nodeById,
      visibleNodeKeys,
      rootKey,
    );
    const presentation = STATUS_PRESENTATION[subagent.status];
    nodes.push({
      key,
      threadId: projection.thread.id,
      kind: "agent",
      sourceNodeId: subagent.id,
      parentKey,
      state: presentation.state,
      statusLabel: presentation.label,
      label: subagent.title || "Subagent",
      providerInstanceId: subagent.providerInstanceId,
      model: subagent.model,
      prompt: subagent.prompt,
      progress: subagent.progress ?? null,
      result: subagent.result,
      childThreadId: subagent.childThreadId,
      startedAt: subagent.startedAt,
      completedAt: subagent.completedAt,
    });
    edges.push({ from: parentKey, to: key });
  }

  const linkedToolItemIds = new Set<TurnItemId>();
  const countedToolNodes = new Set<NodeId>();
  for (const node of visibleExecutionNodes) {
    if (!isActivityNode(node)) continue;
    const key = visibleNodeKeys.get(node.id);
    if (key === undefined) continue;
    const linkedItems = linkedItemsByNode.get(node.id) ?? [];
    const toolItems = linkedItems.filter(isToolItem);
    const requests = requestsByNode.get(node.id) ?? [];
    const inScopeRequests =
      node.kind === "approval_request" || node.kind === "user_input_request"
        ? requests.filter(interactiveRequest)
        : [];
    const pendingRequests = inScopeRequests.filter((request) => request.status === "pending");
    const requestNeedsUser = pendingRequests.length > 0;
    const commandFailed = toolItems.some(
      (item) => item.type === "command_execution" && item.outputIndicatesFailure === true,
    );
    const presentation = commandFailed
      ? { state: "failed" as const, label: "Output indicates failure" }
      : requestNeedsUser
        ? { state: "needs_you" as const, label: "Needs you" }
        : STATUS_PRESENTATION[node.status];
    const parentKey = nearestVisibleParentKey(
      node.parentNodeId,
      nodeById,
      visibleNodeKeys,
      rootKey,
    );
    nodes.push({
      key,
      threadId: projection.thread.id,
      kind: "activity",
      activityKind: activityKind(node),
      sourceNodeId: node.id,
      parentKey,
      state: presentation.state,
      statusLabel: presentation.label,
      label: nodeLabel(node, toolItems),
      turnItemIds: linkedItems.map((item) => item.id),
      errorItemIds: errorsByNode.get(node.id) ?? [],
      runtimeRequestIds: pendingRequests.map((request) => request.id),
      startedAt: node.startedAt ?? earliestTimestamp(linkedItems.map((item) => item.startedAt)),
      completedAt: node.completedAt ?? latestTimestamp(linkedItems.map((item) => item.completedAt)),
    });
    edges.push({ from: parentKey, to: key });
    if (node.kind === "tool_call") {
      if (toolItems.length === 0) countedToolNodes.add(node.id);
      for (const item of toolItems) linkedToolItemIds.add(item.id);
    }
  }

  for (const item of items) {
    if (!isToolItem(item) || item.runId !== runId) continue;
    if (item.nodeId !== null && nodeById.has(item.nodeId)) continue;
    const key = graphKey("activity-item", projection.thread.id, item.id);
    const presentation =
      item.type === "command_execution" && item.outputIndicatesFailure === true
        ? { state: "failed" as const, label: "Output indicates failure" }
        : STATUS_PRESENTATION[item.status];
    nodes.push({
      key,
      threadId: projection.thread.id,
      kind: "activity",
      activityKind: "tool",
      sourceNodeId: null,
      parentKey: rootKey,
      state: presentation.state,
      statusLabel: presentation.label,
      label: toolLabel(item),
      turnItemIds: [item.id],
      errorItemIds: [],
      runtimeRequestIds: [],
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    });
    edges.push({ from: rootKey, to: key });
    linkedToolItemIds.add(item.id);
  }

  const allGraphNodes = nodes;
  const needsYouCount = new Set(
    allGraphNodes.flatMap((node) =>
      node.kind === "activity" && node.state === "needs_you" ? node.runtimeRequestIds : [],
    ),
  ).size;
  return {
    runId,
    nodes: allGraphNodes,
    edges,
    summary: {
      agentCount: allGraphNodes.filter((node) => node.kind === "agent").length,
      toolCallCount: linkedToolItemIds.size + countedToolNodes.size,
      needsYouCount,
      failedCount: allGraphNodes.filter((node) => node.state === "failed").length,
      stoppedCount: allGraphNodes.filter((node) => node.state === "stopped").length,
      observedStartedAt: earliestTimestamp(allGraphNodes.map((node) => node.startedAt)),
      observedCompletedAt: latestTimestamp(allGraphNodes.map((node) => node.completedAt)),
    },
  };
}
