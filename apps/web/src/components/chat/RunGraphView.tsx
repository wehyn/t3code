import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleXIcon,
  HandIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { buildThreadRouteParams } from "../../threadRoutes";
import { RunGraphNodeDetails } from "./RunGraphNodeDetails";

import type {
  RunGraph,
  RunGraphNode,
  RunGraphNodeKey,
  RunGraphState,
} from "@t3tools/client-runtime/state/run-graph";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 88;
const COLUMN_GAP = 64;
const ROW_GAP = 20;
const GRAPH_PADDING = 16;
const STATE_CLASS = {
  call: "text-sky-600 dark:text-sky-400",
  answer: "text-emerald-600 dark:text-emerald-400",
  needs_you: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
  stopped: "text-muted-foreground",
} satisfies Record<RunGraphState, string>;

interface NodePosition {
  readonly column: number;
  readonly row: number;
}

function addMissingPositions(
  nodes: ReadonlyArray<RunGraphNode>,
  edges: RunGraph["edges"],
  previous: ReadonlyMap<RunGraphNodeKey, NodePosition>,
): ReadonlyMap<RunGraphNodeKey, NodePosition> {
  const next = new Map(previous);
  const rowByColumn = new Map<number, Set<number>>();
  for (const position of previous.values()) {
    const rows = rowByColumn.get(position.column) ?? new Set<number>();
    rows.add(position.row);
    rowByColumn.set(position.column, rows);
  }
  for (const node of nodes) {
    if (next.has(node.key)) continue;
    const parentKey = edges.find((edge) => edge.to === node.key)?.from;
    const parentPosition = (parentKey ? next.get(parentKey) : undefined) ?? {
      column: 0,
      row: 0,
    };
    const column = node.parentKey === null ? 0 : parentPosition.column + 1;
    const rows = rowByColumn.get(column) ?? new Set<number>();
    let row = 0;
    while (rows.has(row)) row += 1;
    rows.add(row);
    rowByColumn.set(column, rows);
    next.set(node.key, { column, row });
  }
  return next.size === previous.size ? previous : next;
}

function nodeLabel(
  node: RunGraphNode,
  projection: ThreadStructure,
  workspaceRoot: string | undefined,
): string {
  if (node.kind !== "activity") return node.label;
  const item = projection.turnItems.find((candidate) => candidate.id === node.turnItemIds[0]);
  if (item?.type !== "file_change") return node.label;

  const rawPath = item.changes?.[0]?.path ?? item.fileName;
  const path = formatWorkspaceRelativePath(rawPath, workspaceRoot);
  const displayPath = workspaceRoot
    ? path
    : path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");
  const changeCount = item.changes?.length ?? 0;
  return changeCount > 1 ? `${displayPath} +${changeCount - 1} more` : displayPath;
}

function stateIcon(state: RunGraphState) {
  switch (state) {
    case "call":
      return CircleAlertIcon;
    case "answer":
      return CheckCircle2Icon;
    case "needs_you":
      return HandIcon;
    case "failed":
      return CircleXIcon;
    case "stopped":
      return SquareIcon;
  }
}

function nodeIcon(node: RunGraphNode) {
  if (node.kind === "agent") return BotIcon;
  return node.activityKind === "tool" ? WrenchIcon : HandIcon;
}

function elapsedText(graph: RunGraph, nowMs: number): string {
  const startedAt = graph.summary.observedStartedAt;
  if (startedAt === null) return "Unavailable";
  const isLive = graph.nodes.some((node) => node.state === "call" || node.state === "needs_you");
  const endMs = isLive
    ? nowMs
    : graph.summary.observedCompletedAt === null
      ? nowMs
      : DateTime.toEpochMillis(graph.summary.observedCompletedAt);
  return formatDuration(Math.max(0, endMs - DateTime.toEpochMillis(startedAt)));
}

function edgePath(from: NodePosition, to: NodePosition): string {
  const fromLeft = GRAPH_PADDING + from.column * (NODE_WIDTH + COLUMN_GAP);
  const fromTop = GRAPH_PADDING + from.row * (NODE_HEIGHT + ROW_GAP);
  const toLeft = GRAPH_PADDING + to.column * (NODE_WIDTH + COLUMN_GAP);
  const toTop = GRAPH_PADDING + to.row * (NODE_HEIGHT + ROW_GAP);
  if (from.column < to.column) {
    const startX = fromLeft + NODE_WIDTH;
    const startY = fromTop + NODE_HEIGHT / 2;
    const endX = toLeft;
    const endY = toTop + NODE_HEIGHT / 2;
    const curve = Math.max(24, (endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
  }
  const goingDown = fromTop <= toTop;
  const startX = fromLeft + NODE_WIDTH / 2;
  const startY = fromTop + (goingDown ? NODE_HEIGHT : 0);
  const endX = toLeft + NODE_WIDTH / 2;
  const endY = toTop + (goingDown ? 0 : NODE_HEIGHT);
  const curve = Math.max(24, Math.abs(endY - startY) / 2);
  const direction = goingDown ? 1 : -1;
  return `M ${startX} ${startY} C ${startX} ${startY + direction * curve}, ${endX} ${endY - direction * curve}, ${endX} ${endY}`;
}

function focusPendingRequestUI() {
  const requestPanel = document.querySelector<HTMLElement>(
    '[data-chat-composer-top-drawer="true"]',
  );
  if (requestPanel === null) return;
  requestPanel.scrollIntoView({ block: "nearest" });
  requestPanel.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus();
}

export function RunGraphView(props: {
  readonly graph: RunGraph;
  readonly projection: ThreadStructure;
  readonly environmentId: EnvironmentId;
  readonly runOrdinal: number;
  readonly empty: boolean;
  readonly workspaceRoot?: string | undefined;
}) {
  const [positions, setPositions] = useState(() =>
    addMissingPositions(props.graph.nodes, props.graph.edges, new Map()),
  );
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const graphRef = useRef(props.graph);
  const arrowId = `run-graph-arrow-${useId().replaceAll(":", "")}`;
  const [selectedNodeKey, setSelectedNodeKey] = useState<RunGraphNodeKey | null>(null);
  const navigate = useNavigate();
  const isLive = props.graph.nodes.some(
    (node) => node.state === "call" || node.state === "needs_you",
  );
  const selectedNode = props.graph.nodes.find((node) => node.key === selectedNodeKey) ?? null;
  const nextPositions = addMissingPositions(props.graph.nodes, props.graph.edges, positions);
  if (nextPositions !== positions) setPositions(nextPositions);

  useLayoutEffect(() => {
    graphRef.current = props.graph;
  }, [props.graph]);

  useLayoutEffect(() => {
    const update = () => {
      if (elapsedRef.current) {
        elapsedRef.current.textContent = elapsedText(graphRef.current, Date.now());
      }
    };
    update();
    if (!isLive) return;
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [isLive]);

  const maxColumn = Math.max(0, ...[...positions.values()].map((position) => position.column));
  const maxRow = Math.max(0, ...[...positions.values()].map((position) => position.row));
  const width = GRAPH_PADDING * 2 + NODE_WIDTH + maxColumn * (NODE_WIDTH + COLUMN_GAP);
  const height = GRAPH_PADDING * 2 + NODE_HEIGHT + maxRow * (NODE_HEIGHT + ROW_GAP);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 pb-2">
        <span className="text-sm font-medium">Run {props.runOrdinal}</span>
        <span className="text-xs text-muted-foreground">
          {props.graph.summary.agentCount}{" "}
          {props.graph.summary.agentCount === 1 ? "agent" : "agents"}
        </span>
        <span className="text-xs text-muted-foreground">
          {props.graph.summary.toolCallCount}{" "}
          {props.graph.summary.toolCallCount === 1 ? "tool call" : "tool calls"}
        </span>
        <span aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">
          {props.graph.summary.needsYouCount} request
          {props.graph.summary.needsYouCount === 1 ? " needs" : "s need"} you
        </span>
        <span className="text-xs text-destructive">{props.graph.summary.failedCount} failed</span>
        <span className="text-xs text-muted-foreground">
          {props.graph.summary.stoppedCount} stopped
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Observed by T3 <span ref={elapsedRef}>Unavailable</span>
        </span>
      </div>
      {props.empty ? (
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          No recorded tool or agent activity in this run.
        </p>
      ) : (
        <div className="max-h-80 max-w-full overflow-auto overscroll-x-contain">
          <div
            className="relative"
            role="list"
            aria-label={`Run ${props.runOrdinal} activity graph`}
            style={{ width, height }}
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 overflow-visible"
              width={width}
              height={height}
            >
              <defs>
                <marker
                  id={arrowId}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L6,3 z" className="fill-muted-foreground/60" />
                </marker>
              </defs>
              {props.graph.edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                return (
                  <path
                    key={`${edge.from}:${edge.to}`}
                    d={edgePath(from, to)}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.4"
                    strokeWidth="1.5"
                    markerEnd={`url(#${arrowId})`}
                    className="text-muted-foreground"
                  />
                );
              })}
            </svg>
            {props.graph.nodes.map((node) => {
              const position = positions.get(node.key);
              if (!position) return null;
              const label = nodeLabel(node, props.projection, props.workspaceRoot);
              const left = GRAPH_PADDING + position.column * (NODE_WIDTH + COLUMN_GAP);
              const top = GRAPH_PADDING + position.row * (NODE_HEIGHT + ROW_GAP);
              const StatusIcon = stateIcon(node.state);
              const ActivityIcon = nodeIcon(node);
              const isSelected = selectedNodeKey === node.key;
              return (
                <article
                  key={node.key}
                  role="listitem"
                  aria-label={`${label}, ${node.statusLabel}`}
                  className="absolute z-10 min-h-[5.5rem] w-[12.25rem]"
                  style={{ left, top }}
                  data-run-graph-position={`${left},${top}`}
                >
                  <button
                    type="button"
                    aria-label={`${label}, ${node.statusLabel}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (
                        node.kind === "activity" &&
                        (node.activityKind === "approval" || node.activityKind === "question")
                      ) {
                        setSelectedNodeKey(null);
                        focusPendingRequestUI();
                        return;
                      }
                      setSelectedNodeKey((current) => (current === node.key ? null : node.key));
                    }}
                    className={`flex h-full w-full flex-col justify-center gap-2 rounded-xl border bg-background px-3 py-2 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isSelected ? "border-primary ring-1 ring-primary/40" : "border-border"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ActivityIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusIcon
                        aria-hidden
                        className={`size-3.5 shrink-0 ${STATE_CLASS[node.state]}`}
                      />
                      <span className="truncate">{node.statusLabel}</span>
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      )}
      {selectedNode ? (
        <RunGraphNodeDetails
          environmentId={props.environmentId}
          projection={props.projection}
          node={selectedNode}
          onOpenChildThread={(threadId: ThreadId) => {
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
            });
          }}
        />
      ) : null}
    </div>
  );
}
