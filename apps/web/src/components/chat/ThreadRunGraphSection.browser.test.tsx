import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import type {
  EnvironmentThreadStructure,
  ThreadStructure,
} from "@t3tools/client-runtime/state/models";
import { expect, it, vi } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

const state = vi.hoisted<{ quietThread: EnvironmentThreadStructure | null }>(() => ({
  quietThread: null,
}));

vi.mock(import("../../state/entities"), () => ({
  useQuietThreadProjection: () => state.quietThread,
}));

import { render } from "../../../test/render";
import { ThreadRunGraphSection } from "./ThreadRunGraphSection";

const ENVIRONMENT_ID = EnvironmentId.make("run-graph-environment");
const THREAD_ID = ThreadId.make("run-graph-thread");
const PROVIDER_ID = ProviderInstanceId.make("codex");
const PROJECT_ID = ProjectId.make("run-graph-project");
const RUN_ID = RunId.make("run-graph-run");
const ROOT_ID = NodeId.make("run-graph-root");
const NOW = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const SECTION_PROPS = { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID };

function run(overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run {
  return {
    id: RUN_ID,
    threadId: THREAD_ID,
    ordinal: 2,
    providerInstanceId: PROVIDER_ID,
    modelSelection: { instanceId: PROVIDER_ID, model: "gpt-5.4" },
    providerThreadId: null,
    userMessageId: MessageId.make("run-graph-message"),
    rootNodeId: ROOT_ID,
    activeAttemptId: null,
    status: "running",
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
    ...overrides,
  };
}

function executionNode(
  id: NodeId,
  overrides: Partial<OrchestrationV2ExecutionNode> = {},
): OrchestrationV2ExecutionNode {
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
    startedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function rootNode(overrides: Partial<OrchestrationV2ExecutionNode> = {}) {
  return executionNode(ROOT_ID, {
    parentNodeId: null,
    kind: "root_turn",
    status: "running",
    ...overrides,
  });
}

function commandItem(
  id: string,
  nodeId: NodeId,
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
    status: "running",
    title: null,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
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
    createdAt: NOW,
    resolvedAt: null,
  };
}

function projection(
  input: {
    readonly runs?: ReadonlyArray<OrchestrationV2Run>;
    readonly nodes?: ReadonlyArray<OrchestrationV2ExecutionNode>;
    readonly turnItems?: ReadonlyArray<OrchestrationV2TurnItem>;
    readonly runtimeRequests?: ReadonlyArray<OrchestrationV2RuntimeRequest>;
  } = {},
): ThreadStructure {
  const base: OrchestrationV2ThreadProjection = {
    thread: {
      id: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Run graph thread",
      providerInstanceId: PROVIDER_ID,
      modelSelection: { instanceId: PROVIDER_ID, model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [...(input.runs ?? [])],
    attempts: [],
    nodes: [...(input.nodes ?? [])],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [...(input.runtimeRequests ?? [])],
    messages: [],
    plans: [],
    turnItems: [...(input.turnItems ?? [])],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: NOW,
  };
  return base;
}

function setProjection(next: ThreadStructure | null) {
  state.quietThread = next === null ? null : { environmentId: ENVIRONMENT_ID, projection: next };
}

function view() {
  return <ThreadRunGraphSection {...SECTION_PROPS} />;
}

it("distinguishes a thread with no runs from a run with no recorded activity", async () => {
  setProjection(null);
  await using screen = await render(view());
  expect(screen.getByText("Loading run graph…")).toBeTruthy();

  setProjection(projection());
  await screen.rerender(view());
  expect(screen.getByText("No runs yet.")).toBeTruthy();

  setProjection(
    projection({
      runs: [run({ status: "completed" })],
      nodes: [rootNode({ status: "completed" })],
    }),
  );
  await screen.rerender(view());
  expect(screen.getByText("No recorded tool or agent activity in this run.")).toBeTruthy();
});

it("shows graph counts and updates a late parent without moving its child", async () => {
  const toolId = NodeId.make("run-graph-tool");
  const parentId = NodeId.make("run-graph-late-parent");
  const tool = executionNode(toolId, { parentNodeId: parentId });
  const initial = projection({
    runs: [run()],
    nodes: [rootNode(), tool],
    turnItems: [commandItem("run-graph-command", toolId)],
  });
  setProjection(initial);
  const container = document.createElement("div");
  container.style.width = "280px";
  await using screen = await render(view(), { container });

  expect(screen.getByText("Run 2")).toBeTruthy();
  expect(screen.getByText("1 agent")).toBeTruthy();
  expect(screen.getByText("1 tool call")).toBeTruthy();
  expect(screen.getByText("0 failed")).toBeTruthy();
  expect(screen.getByText("0 stopped")).toBeTruthy();
  expect(screen.getByText("Observed by T3")).toBeTruthy();
  const child = screen.container.querySelector<HTMLElement>(
    '[role="listitem"][aria-label="pnpm test, Running"]',
  );
  if (child === null) throw new Error("Expected the tool node");
  const childPosition = child.getAttribute("data-run-graph-position");
  const viewport = child.parentElement?.parentElement;
  expect(viewport && viewport.scrollWidth > viewport.clientWidth).toBe(true);

  const lateParent = executionNode(parentId, {
    kind: "subagent",
    parentNodeId: ROOT_ID,
  });
  setProjection(
    projection({
      runs: [run()],
      nodes: [rootNode(), lateParent, tool],
      turnItems: [commandItem("run-graph-command", toolId)],
    }),
  );
  await screen.rerender(view());

  const updatedChild = screen.container.querySelector<HTMLElement>(
    '[role="listitem"][aria-label="pnpm test, Running"]',
  );
  expect(updatedChild?.getAttribute("data-run-graph-position")).toBe(childPosition);
  expect(screen.getByRole("listitem", { name: "Subagent, Running" })).toBeTruthy();
  expect(screen.container.querySelectorAll('[role="list"] svg path[marker-end]')).toHaveLength(2);
});

it("selects the newest active run and reports pending requests", async () => {
  const approvalId = NodeId.make("run-graph-approval");
  const activeRunId = RunId.make("run-graph-active-run");
  const olderRun = run({ status: "completed", ordinal: 1 });
  const activeRootId = NodeId.make("run-graph-active-root");
  const activeRun = run({
    id: activeRunId,
    ordinal: 3,
    rootNodeId: activeRootId,
    status: "waiting",
  });
  const activeRoot = rootNode({
    id: activeRootId,
    runId: activeRunId,
    rootNodeId: activeRootId,
  });
  const approval = executionNode(approvalId, {
    runId: activeRunId,
    rootNodeId: activeRootId,
    parentNodeId: activeRoot.id,
    kind: "approval_request",
    status: "waiting",
  });
  setProjection(
    projection({
      runs: [olderRun, activeRun],
      nodes: [rootNode({ status: "completed" }), activeRoot, approval],
      runtimeRequests: [pendingRequest(approvalId)],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 3")).toBeTruthy();
  expect(screen.getByText("1 request needs you")).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "Approval request, Needs you" })).toBeTruthy();
});

it("treats queued runs as active when choosing the run to show", async () => {
  const olderRunId = RunId.make("run-graph-older-run");
  const queuedRunId = RunId.make("run-graph-queued-run");
  const olderRootId = NodeId.make("run-graph-older-root");
  const queuedRootId = NodeId.make("run-graph-queued-root");
  setProjection(
    projection({
      runs: [
        run({ id: olderRunId, ordinal: 1, rootNodeId: olderRootId, status: "running" }),
        run({ id: queuedRunId, ordinal: 2, rootNodeId: queuedRootId, status: "queued" }),
      ],
      nodes: [
        rootNode({ id: olderRootId, runId: olderRunId, rootNodeId: olderRootId }),
        rootNode({ id: queuedRootId, runId: queuedRunId, rootNodeId: queuedRootId }),
      ],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 2")).toBeTruthy();
});
