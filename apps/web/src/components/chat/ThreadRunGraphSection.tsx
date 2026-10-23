import { latestProviderTurnForAttempt, type OrchestrationV2Run } from "@t3tools/contracts";
import { deriveRunGraph } from "@t3tools/client-runtime/state/run-graph";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { useQuietThreadProjection } from "../../state/entities";
import { RunGraphView } from "./RunGraphView";

type ThreadProjection = ThreadStructure;
type RuntimeRequestKind = ThreadProjection["runtimeRequests"][number]["kind"];

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

function hasActiveSignal(projection: ThreadProjection, run: OrchestrationV2Run): boolean {
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

function selectRun(projection: ThreadProjection): OrchestrationV2Run | null {
  const activeRuns = projection.runs.filter(
    (run) =>
      RUN_STATUS_IS_ACTIVE[run.status] ||
      (run.status === "waiting" && hasActiveSignal(projection, run)),
  );
  return latestRun(activeRuns) ?? latestRun(projection.runs);
}

export function ThreadRunGraphSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useQuietThreadProjection(ref)?.projection ?? null;
  const run = useMemo(() => (projection === null ? null : selectRun(projection)), [projection]);
  const graph = useMemo(
    () =>
      run === null || projection === null ? null : deriveRunGraph({ projection, runId: run.id }),
    [projection, run?.id],
  );
  const headingId = "thread-details-run-graph-heading";

  return (
    <ThreadDetailsSection headingId={headingId} title="Run graph">
      {graph === null || run === null ? (
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          {projection === null ? "Loading run graph…" : "No runs yet."}
        </p>
      ) : (
        <RunGraphView graph={graph} runOrdinal={run.ordinal} empty={graph.nodes.length === 1} />
      )}
    </ThreadDetailsSection>
  );
}
