import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import type {
  EnvironmentThreadStructure,
  ThreadStructure,
} from "@t3tools/client-runtime/state/models";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import * as DateTime from "effect/DateTime";

const state = vi.hoisted<{
  quietThread: EnvironmentThreadStructure | null;
}>(() => ({
  quietThread: null,
}));

vi.mock(import("../../state/entities"), () => ({
  useQuietThreadProjection: () => state.quietThread,
  useThreadRelationshipShells: () => [],
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

function pendingRequest(
  nodeId: NodeId,
  kind: "command" | "user_input" = "command",
): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make(`run-graph-request-${nodeId}`),
    nodeId,
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status: "pending",
    responseCapability: { type: "message" },
    createdAt: NOW,
    resolvedAt: null,
  };
}

function subagent(id: NodeId, childThreadId: ThreadId): OrchestrationV2Subagent {
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
    childThreadId,
    nativeTaskRef: null,
    prompt: "Inspect the failing tests",
    title: "Test agent",
    model: "gpt-5.4",
    status: "running",
    result: "Two tests need updates",
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
  };
}

function projection(
  input: {
    readonly runs?: ReadonlyArray<OrchestrationV2Run>;
    readonly nodes?: ReadonlyArray<OrchestrationV2ExecutionNode>;
    readonly subagents?: ReadonlyArray<OrchestrationV2Subagent>;
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
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: THREAD_ID,
      },
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
    subagents: [...(input.subagents ?? [])],
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

function setup() {
  state.quietThread = null;
}

function view() {
  return <ThreadRunGraphSection {...SECTION_PROPS} />;
}

it("shows the main agent when a completed run has no subagents", async () => {
  setup();
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
  expect(screen.getByRole("listitem", { name: /^Main agent,/ })).toBeTruthy();
});

it("keeps agent nodes visible and hides tool calls as subagents appear", async () => {
  setup();
  const toolId = NodeId.make("run-graph-tool");
  const parentId = NodeId.make("run-graph-late-parent");
  const tool = executionNode(toolId, { parentNodeId: parentId });
  const initial = projection({
    runs: [run()],
    nodes: [rootNode(), tool],
    turnItems: [commandItem("run-graph-command", toolId)],
  });
  setProjection(initial);
  await using screen = await render(view());

  expect(screen.getByRole("listitem", { name: "Main agent, Running" })).toBeTruthy();
  expect(
    screen.container.querySelector('[role="listitem"][aria-label="pnpm test, Running"]'),
  ).toBeNull();

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

  expect(screen.getByRole("listitem", { name: "Main agent, Running" })).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "Subagent, Running" })).toBeTruthy();
  expect(
    screen.container.querySelector('[role="listitem"][aria-label="pnpm test, Running"]'),
  ).toBeNull();
  expect(screen.container.querySelectorAll('[role="list"] svg path[marker-end]')).toHaveLength(1);
});

it("selects the newest active run and reports pending requests", async () => {
  setup();
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
  setup();
  const queuedRunId = RunId.make("run-graph-queued-run");
  const queuedRootId = NodeId.make("run-graph-queued-root");
  setProjection(
    projection({
      runs: [
        run({
          id: queuedRunId,
          ordinal: 2,
          rootNodeId: queuedRootId,
          status: "queued",
        }),
      ],
      nodes: [
        rootNode({
          id: queuedRootId,
          runId: queuedRunId,
          rootNodeId: queuedRootId,
        }),
      ],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 2")).toBeTruthy();
});

it("chooses a queued run over a newer cancelled run", async () => {
  setup();
  const queuedRunId = RunId.make("run-graph-queued-run");
  const cancelledRunId = RunId.make("run-graph-cancelled-run");
  const queuedRootId = NodeId.make("run-graph-queued-root");
  const cancelledRootId = NodeId.make("run-graph-cancelled-root");
  setProjection(
    projection({
      runs: [
        run({ id: queuedRunId, ordinal: 2, rootNodeId: queuedRootId, status: "queued" }),
        run({ id: cancelledRunId, ordinal: 3, rootNodeId: cancelledRootId, status: "cancelled" }),
      ],
      nodes: [
        rootNode({ id: queuedRootId, runId: queuedRunId, rootNodeId: queuedRootId }),
        rootNode({
          id: cancelledRootId,
          runId: cancelledRunId,
          rootNodeId: cancelledRootId,
          status: "cancelled",
        }),
      ],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 2")).toBeTruthy();
});

it("prefers a running run over a queued follow-up", async () => {
  setup();
  const runningRunId = RunId.make("run-graph-running-run");
  const queuedRunId = RunId.make("run-graph-queued-follow-up");
  const runningRootId = NodeId.make("run-graph-running-root");
  const queuedRootId = NodeId.make("run-graph-queued-root");
  setProjection(
    projection({
      runs: [
        run({ id: runningRunId, ordinal: 1, rootNodeId: runningRootId, status: "running" }),
        run({ id: queuedRunId, ordinal: 2, rootNodeId: queuedRootId, status: "queued" }),
      ],
      nodes: [
        rootNode({ id: runningRootId, runId: runningRunId, rootNodeId: runningRootId }),
        rootNode({ id: queuedRootId, runId: queuedRunId, rootNodeId: queuedRootId }),
      ],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 1")).toBeTruthy();
});

it("uses the earlier completed run when the latest run was rolled back", async () => {
  setup();
  const completedRootId = NodeId.make("run-graph-completed-root");
  const rolledBackRunId = RunId.make("run-graph-rolled-back-run");
  const rolledBackRootId = NodeId.make("run-graph-rolled-back-root");
  setProjection(
    projection({
      runs: [
        run({ ordinal: 1, rootNodeId: completedRootId, status: "completed" }),
        run({
          id: rolledBackRunId,
          ordinal: 2,
          rootNodeId: rolledBackRootId,
          status: "rolled_back",
        }),
      ],
      nodes: [
        rootNode({ id: completedRootId, rootNodeId: completedRootId, status: "completed" }),
        rootNode({
          id: rolledBackRootId,
          runId: rolledBackRunId,
          rootNodeId: rolledBackRootId,
          status: "rolled_back",
        }),
      ],
    }),
  );
  await using screen = await render(view());

  expect(screen.getByText("Run 1")).toBeTruthy();

  setProjection(
    projection({
      runs: [
        run({
          id: rolledBackRunId,
          ordinal: 2,
          rootNodeId: rolledBackRootId,
          status: "rolled_back",
        }),
      ],
      nodes: [
        rootNode({
          id: rolledBackRootId,
          runId: rolledBackRunId,
          rootNodeId: rolledBackRootId,
          status: "rolled_back",
        }),
      ],
    }),
  );
  await screen.rerender(view());
  expect(screen.getByText("No runs yet.")).toBeTruthy();
});

it("resets node positions when the selected run changes in a mounted panel", async () => {
  setup();
  const firstRunId = RunId.make("run-graph-first-mounted-run");
  const firstRootId = NodeId.make("run-graph-first-mounted-root");
  const secondRunId = RunId.make("run-graph-second-mounted-run");
  const secondRootId = NodeId.make("run-graph-second-mounted-root");
  setProjection(
    projection({
      runs: [run({ id: firstRunId, ordinal: 1, rootNodeId: firstRootId })],
      nodes: [rootNode({ id: firstRootId, runId: firstRunId, rootNodeId: firstRootId })],
    }),
  );
  await using screen = await render(view());

  setProjection(
    projection({
      runs: [
        run({ id: firstRunId, ordinal: 1, rootNodeId: firstRootId, status: "completed" }),
        run({ id: secondRunId, ordinal: 2, rootNodeId: secondRootId }),
      ],
      nodes: [
        rootNode({
          id: firstRootId,
          runId: firstRunId,
          rootNodeId: firstRootId,
          status: "completed",
        }),
        rootNode({ id: secondRootId, runId: secondRunId, rootNodeId: secondRootId }),
        executionNode(NodeId.make("run-graph-second-run-tool"), {
          runId: secondRunId,
          rootNodeId: secondRootId,
          parentNodeId: secondRootId,
        }),
      ],
    }),
  );
  await screen.rerender(view());

  const root = screen.container.querySelector<HTMLElement>(
    '[role="listitem"][aria-label="Main agent, Running"]',
  );
  expect(root?.getAttribute("data-run-graph-position")).toBe("16,16");
});

it("shows agent details and opens its child thread", async () => {
  setup();
  const agentId = NodeId.make("run-graph-agent");
  const childThreadId = ThreadId.make("run-graph-child-thread");
  setProjection(
    projection({
      runs: [run()],
      nodes: [rootNode(), executionNode(agentId, { kind: "subagent", parentNodeId: ROOT_ID })],
      subagents: [subagent(agentId, childThreadId)],
    }),
  );
  await using screen = await render(view());

  await userEvent.click(screen.getByRole("button", { name: "Test agent, Running" }));
  expect(screen.getByText("Provider codex")).toBeTruthy();
  expect(screen.getByText("Model gpt-5.4")).toBeTruthy();
  expect(screen.getByText("Inspect the failing tests")).toBeTruthy();
  expect(screen.getByText("Two tests need updates")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Open child thread" }));
  expect(screen.router?.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${childThreadId}`);
});

it("moves approval and question selection to the existing composer request UI", async () => {
  setup();
  const approvalId = NodeId.make("run-graph-approval-node");
  const questionId = NodeId.make("run-graph-question-node");
  const requestUi = (
    <div data-chat-composer-top-drawer="true">
      <button type="button">Respond to current request</button>
    </div>
  );
  setProjection(
    projection({
      runs: [run()],
      nodes: [
        rootNode(),
        executionNode(approvalId, {
          kind: "approval_request",
          status: "waiting",
        }),
        executionNode(questionId, {
          kind: "user_input_request",
          status: "waiting",
        }),
      ],
      runtimeRequests: [
        pendingRequest(approvalId, "command"),
        pendingRequest(questionId, "user_input"),
      ],
    }),
  );
  await using screen = await render(
    <>
      {requestUi}
      {view()}
    </>,
  );
  const drawer = screen.container.querySelector<HTMLElement>(
    '[data-chat-composer-top-drawer="true"]',
  );
  if (drawer === null) throw new Error("Expected the composer request UI");
  const respondButton = drawer.querySelector<HTMLButtonElement>("button");
  if (respondButton === null) throw new Error("Expected a request action");
  using _scrollIntoView = vi.spyOn(drawer, "scrollIntoView").mockImplementation(() => {});

  const approvalButton = screen.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Approval request, Needs you"]',
  );
  if (approvalButton === null) throw new Error("Expected the approval node button");
  approvalButton.focus();
  await userEvent.keyboard("{Enter}");
  expect(drawer.scrollIntoView).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(respondButton);
  const questionButton = screen.container.querySelector<HTMLButtonElement>(
    'button[aria-label="User input, Needs you"]',
  );
  if (questionButton === null) throw new Error("Expected the question node button");
  questionButton.focus();
  await userEvent.keyboard("{Enter}");
  expect(drawer.scrollIntoView).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(respondButton);
});
