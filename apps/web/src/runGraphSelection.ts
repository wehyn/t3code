import {
  latestProviderTurnForAttempt,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import { useQuietThreadProjection, useThreadRelationshipShells } from "./state/entities";

type RuntimeRequestKind = ThreadStructure["runtimeRequests"][number]["kind"];

export type RunGraphSelection =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "active";
      readonly projection: ThreadStructure;
      readonly run: OrchestrationV2Run;
    }
  | {
      readonly kind: "inactive";
      readonly projection: ThreadStructure;
      readonly run: OrchestrationV2Run;
    };

export type ActiveRunGraphSelection = Extract<RunGraphSelection, { readonly kind: "active" }>;

const RUN_STATUS_IS_ACTIVE = {
  preparing: true,
  queued: true,
  starting: true,
  running: true,
  waiting: false,
  completed: false,
  interrupted: false,
  failed: false,
  cancelled: false,
  rolled_back: false,
} as const satisfies Record<OrchestrationV2Run["status"], boolean>;

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

function hasActiveSignal(projection: ThreadStructure, run: OrchestrationV2Run): boolean {
  const runNodes = projection.nodes.filter((node) => node.runId === run.id);
  const runNodeIds = new Set(runNodes.map((node) => node.id));
  const nodeById = new Map(runNodes.map((node) => [node.id, node]));
  const providerTurn = latestProviderTurnForAttempt(projection.providerTurns, run.activeAttemptId);
  const activeProviderTurn =
    providerTurn?.status === "pending" || providerTurn?.status === "running";
  const activeChild = projection.subagents.some(
    (subagent) =>
      (subagent.runId === run.id || runNodeIds.has(subagent.parentNodeId)) &&
      (subagent.status === "pending" ||
        subagent.status === "running" ||
        subagent.status === "waiting"),
  );
  const activeRequest = projection.runtimeRequests.some((request) => {
    const node = nodeById.get(request.nodeId);
    return (
      node !== undefined &&
      node.status !== "rolled_back" &&
      (node.kind === "approval_request" || node.kind === "user_input_request") &&
      request.status === "pending" &&
      REQUEST_KIND_IS_INTERACTIVE[request.kind]
    );
  });
  return activeProviderTurn || activeChild || activeRequest;
}

function latestRun(runs: ReadonlyArray<OrchestrationV2Run>): OrchestrationV2Run | null {
  return runs.reduce<OrchestrationV2Run | null>(
    (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
    null,
  );
}

function isActiveRunStatus(status: OrchestrationV2ThreadShell["status"]): boolean {
  return (
    status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting"
  );
}

function hasActiveLineageSubagent(
  ref: ScopedThreadRef,
  shells: ReadonlyArray<OrchestrationV2ThreadShell>,
): boolean {
  return shells.some(
    (thread) =>
      thread.lineage.parentThreadId === ref.threadId &&
      thread.lineage.relationshipToParent === "subagent" &&
      isActiveRunStatus(thread.activityRunStatus ?? thread.status),
  );
}

function selectRunGraphSelection(
  projection: ThreadStructure | null,
  hasActiveChildThread = false,
): RunGraphSelection {
  if (projection === null) return { kind: "loading" };

  const availableRuns = projection.runs.filter((run) => run.status !== "rolled_back");
  const latestAvailableRun = latestRun(availableRuns);
  const activeRuns = availableRuns.filter(
    (run) =>
      RUN_STATUS_IS_ACTIVE[run.status] ||
      (run.status === "waiting" && hasActiveSignal(projection, run)) ||
      (hasActiveChildThread && run.id === latestAvailableRun?.id),
  );
  const run =
    latestRun(activeRuns.filter((candidate) => candidate.status !== "queued")) ??
    latestRun(activeRuns);
  if (run !== null) return { kind: "active", projection, run };

  return latestAvailableRun === null
    ? { kind: "empty" }
    : { kind: "inactive", projection, run: latestAvailableRun };
}

export function useRunGraphSelection(ref: ScopedThreadRef): RunGraphSelection {
  const projection = useQuietThreadProjection(ref)?.projection ?? null;
  const shells = useThreadRelationshipShells(ref);
  return selectRunGraphSelection(projection, hasActiveLineageSubagent(ref, shells));
}
