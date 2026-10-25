import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleXIcon,
  HandIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observeResize } from "../../lib/observeResize";
import { providersIgnoringCheckedAtAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { RunGraphNodeDetails } from "./RunGraphNodeDetails";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { RUN_GRAPH_MIN_ZOOM } from "../../runGraphCardStore";
import type { RunGraphCanvasPan, RunGraphCanvasView } from "../../runGraphCardStore";

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
const GRID_SIZE = 24;
const GRID_BACKGROUND_IMAGE = [
  "linear-gradient(to right, color-mix(in srgb, var(--border) 30%, transparent) 1px, transparent 1px)",
  "linear-gradient(to bottom, color-mix(in srgb, var(--border) 30%, transparent) 1px, transparent 1px)",
  "linear-gradient(to right, color-mix(in srgb, var(--border) 48%, transparent) 1px, transparent 1px)",
  "linear-gradient(to bottom, color-mix(in srgb, var(--border) 48%, transparent) 1px, transparent 1px)",
].join(", ");
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
  const nodeKeys = new Set(nodes.map((node) => node.key));
  const next = new Map([...previous].filter(([key]) => nodeKeys.has(key)));
  const rowByColumn = new Map<number, Set<number>>();
  for (const position of next.values()) {
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
  return next.size === previous.size && nodes.every((node) => previous.has(node.key))
    ? previous
    : next;
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

function activeToolByAgent(graph: RunGraph): ReadonlyMap<RunGraphNodeKey, string> {
  const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const activeToolByAgent = new Map<RunGraphNodeKey, string>();
  for (const node of graph.nodes) {
    if (
      node.kind !== "activity" ||
      node.activityKind !== "tool" ||
      node.statusLabel !== "Running" ||
      node.label.trim() === "" ||
      node.label === "Tool call"
    ) {
      continue;
    }
    const visited = new Set<RunGraphNodeKey>();
    let parentKey = node.parentKey;
    while (parentKey !== null && !visited.has(parentKey)) {
      visited.add(parentKey);
      const parent = nodesByKey.get(parentKey);
      if (parent?.kind === "agent") {
        activeToolByAgent.set(parent.key, node.label);
        break;
      }
      parentKey = parent?.parentKey ?? null;
    }
  }
  return activeToolByAgent;
}

function visibleRunGraph(graph: RunGraph): Pick<RunGraph, "nodes" | "edges"> {
  const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const nodes = graph.nodes.filter(
    (node) =>
      (node.kind === "agent" && (node.parentKey === null || node.state !== "answer")) ||
      (node.kind === "activity" && node.activityKind !== "tool"),
  );
  const visibleKeys = new Set(nodes.map((node) => node.key));
  const visibleParent = (node: RunGraphNode): RunGraphNodeKey | null => {
    const visited = new Set<RunGraphNodeKey>();
    let parentKey = node.parentKey;
    while (parentKey !== null && !visibleKeys.has(parentKey) && !visited.has(parentKey)) {
      visited.add(parentKey);
      parentKey = nodesByKey.get(parentKey)?.parentKey ?? null;
    }
    return parentKey;
  };
  const visibleNodes = nodes.map((node) => ({ ...node, parentKey: visibleParent(node) }));
  return {
    nodes: visibleNodes,
    edges: visibleNodes.flatMap((node) =>
      node.parentKey === null ? [] : [{ from: node.parentKey, to: node.key }],
    ),
  };
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

function centeredPan(viewport: HTMLElement, zoom: number): RunGraphCanvasPan {
  const rect = viewport.getBoundingClientRect();
  return {
    x: rect.width / 2 - (GRAPH_PADDING + NODE_WIDTH / 2) * zoom,
    y: rect.height / 2 - (GRAPH_PADDING + NODE_HEIGHT / 2) * zoom,
  };
}

function writeCanvasPan(
  viewport: HTMLElement,
  canvas: HTMLElement,
  pan: RunGraphCanvasPan,
  zoom: number,
) {
  const minorGridSize = GRID_SIZE * zoom;
  const majorGridSize = minorGridSize * 5;
  const minorGrid = `${minorGridSize}px ${minorGridSize}px`;
  const majorGrid = `${majorGridSize}px ${majorGridSize}px`;
  viewport.style.backgroundSize = `${minorGrid}, ${minorGrid}, ${majorGrid}, ${majorGrid}`;
  viewport.style.backgroundPosition = `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`;
  canvas.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
}

export function RunGraphView(props: {
  readonly graph: RunGraph;
  readonly environmentId: EnvironmentId;
  readonly runOrdinal: number;
  readonly zoom: number;
  readonly pan: RunGraphCanvasPan | null;
  readonly onPanChange?: ((pan: RunGraphCanvasPan) => void) | undefined;
  readonly onViewChange?: ((view: RunGraphCanvasView) => void) | undefined;
  readonly seenSubagentKeys: ReadonlyArray<string>;
  readonly onSubagentsSeen?: ((keys: ReadonlyArray<string>) => void) | undefined;
}) {
  const activeTools = activeToolByAgent(props.graph);
  const graph = visibleRunGraph(props.graph);
  const subagentKeys = graph.nodes
    .filter((node) => node.kind === "agent" && node.parentKey !== null)
    .map((node) => node.key);
  const subagentSignature = subagentKeys.join("\0");
  const seenSubagentSignature = props.seenSubagentKeys.join("\0");
  const [positions, setPositions] = useState(() =>
    addMissingPositions(graph.nodes, graph.edges, new Map()),
  );
  const arrowId = `run-graph-arrow-${useId().replaceAll(":", "")}`;
  const [selectedNodeKey, setSelectedNodeKey] = useState<RunGraphNodeKey | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const selectedNodeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panRef = useRef<RunGraphCanvasPan | null>(null);
  const lastZoomRef = useRef(props.zoom);
  const panChangeRef = useRef(props.onPanChange);
  const viewChangeRef = useRef(props.onViewChange);
  const subagentsSeenRef = useRef(props.onSubagentsSeen);
  const subagentKeysRef = useRef(subagentKeys);
  const seenSubagentKeysRef = useRef(props.seenSubagentKeys);
  const panGestureRef = useRef<{
    readonly pointerId: number;
    readonly pointerX: number;
    readonly pointerY: number;
    readonly startPan: RunGraphCanvasPan;
  } | null>(null);
  const navigate = useNavigate();
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(props.environmentId));
  const providersByInstanceId = new Map(
    providers.map((provider) => [provider.instanceId, provider]),
  );
  const selectedNode = graph.nodes.find((node) => node.key === selectedNodeKey) ?? null;
  const nextPositions = addMissingPositions(graph.nodes, graph.edges, positions);
  if (nextPositions !== positions) setPositions(nextPositions);
  if (selectedNodeKey !== null && selectedNode === null) setSelectedNodeKey(null);

  useLayoutEffect(() => {
    panChangeRef.current = props.onPanChange;
    viewChangeRef.current = props.onViewChange;
    subagentsSeenRef.current = props.onSubagentsSeen;
    subagentKeysRef.current = subagentKeys;
    seenSubagentKeysRef.current = props.seenSubagentKeys;
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;

    const applyPan = () => {
      const previousZoom = lastZoomRef.current;
      const currentPan = panRef.current ?? props.pan;
      let nextPan: RunGraphCanvasPan;
      if (currentPan === null) {
        nextPan = centeredPan(viewport, props.zoom);
      } else if (previousZoom !== props.zoom) {
        const rect = viewport.getBoundingClientRect();
        const ratio = props.zoom / previousZoom;
        nextPan = {
          x: rect.width / 2 - (rect.width / 2 - currentPan.x) * ratio,
          y: rect.height / 2 - (rect.height / 2 - currentPan.y) * ratio,
        };
      } else {
        nextPan = currentPan;
      }
      panRef.current = nextPan;
      lastZoomRef.current = props.zoom;
      writeCanvasPan(viewport, canvas, nextPan, props.zoom);
      if (props.pan !== null && previousZoom !== props.zoom) {
        panChangeRef.current?.(nextPan);
      }
    };

    applyPan();
    return observeResize(viewport, () => {
      if (props.pan !== null || panGestureRef.current !== null) return;
      const nextPan = centeredPan(viewport, props.zoom);
      panRef.current = nextPan;
      writeCanvasPan(viewport, canvas, nextPan, props.zoom);
    });
  }, [props.pan, props.zoom]);

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button")))
      return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const startPan = panRef.current ?? centeredPan(viewport, props.zoom);
    panRef.current = startPan;
    panGestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startPan,
    };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    setIsPanning(true);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!gesture || !viewport || !canvas || gesture.pointerId !== event.pointerId) return;
    const nextPan = {
      x: gesture.startPan.x + event.clientX - gesture.pointerX,
      y: gesture.startPan.y + event.clientY - gesture.pointerY,
    };
    panRef.current = nextPan;
    writeCanvasPan(viewport, canvas, nextPan, props.zoom);
    event.preventDefault();
  };

  const finishCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!gesture || !viewport || !canvas || gesture.pointerId !== event.pointerId) return;
    const pan = {
      x: gesture.startPan.x + event.clientX - gesture.pointerX,
      y: gesture.startPan.y + event.clientY - gesture.pointerY,
    };
    panGestureRef.current = null;
    panRef.current = pan;
    writeCanvasPan(viewport, canvas, pan, props.zoom);
    panChangeRef.current?.(pan);
    setIsPanning(false);
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
  };

  const maxColumn = Math.max(0, ...graph.nodes.map((node) => positions.get(node.key)?.column ?? 0));
  const maxRow = Math.max(0, ...graph.nodes.map((node) => positions.get(node.key)?.row ?? 0));
  const width = GRAPH_PADDING * 2 + NODE_WIDTH + maxColumn * (NODE_WIDTH + COLUMN_GAP);
  const height = GRAPH_PADDING * 2 + NODE_HEIGHT + maxRow * (NODE_HEIGHT + ROW_GAP);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const fitToNewSubagents = () => {
      const currentSubagentKeys = subagentKeysRef.current;
      const seenKeys = new Set(seenSubagentKeysRef.current);
      if (
        currentSubagentKeys.join("\0") !== subagentSignature ||
        seenSubagentKeysRef.current.join("\0") !== seenSubagentSignature
      ) {
        return;
      }
      if (!currentSubagentKeys.some((key) => !seenKeys.has(key))) return;
      const rect = viewport.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const availableWidth = Math.max(1, rect.width - 16);
      const availableHeight = Math.max(1, rect.height - 16);
      const zoom = Math.max(
        RUN_GRAPH_MIN_ZOOM,
        Math.min(props.zoom, availableWidth / width, availableHeight / height),
      );
      const pan = {
        x: (rect.width - width * zoom) / 2,
        y: (rect.height - height * zoom) / 2,
      };
      seenSubagentKeysRef.current = [...new Set([...seenKeys, ...currentSubagentKeys])];
      panRef.current = pan;
      lastZoomRef.current = zoom;
      writeCanvasPan(viewport, canvas, pan, zoom);
      viewChangeRef.current?.({ zoom, pan });
      subagentsSeenRef.current?.(currentSubagentKeys);
    };

    fitToNewSubagents();
    return observeResize(viewport, fitToNewSubagents);
  }, [subagentSignature, seenSubagentSignature, width, height, props.zoom]);

  return (
    <div className="relative h-full min-h-0 min-w-0">
      {graph.nodes.length === 0 ? (
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          No agent activity recorded in this run.
        </p>
      ) : (
        <div
          ref={viewportRef}
          role="region"
          aria-label="Agent graph canvas"
          className={`relative h-full min-h-0 w-full touch-none overflow-hidden rounded-md cursor-grab select-none ${isPanning ? "cursor-grabbing" : ""}`}
          style={{ backgroundImage: GRID_BACKGROUND_IMAGE }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={finishCanvasPan}
          onPointerCancel={finishCanvasPan}
        >
          <div
            ref={canvasRef}
            className="absolute top-0 left-0 origin-top-left"
            style={{ width, height }}
          >
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
                {graph.edges.map((edge) => {
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
              {graph.nodes.map((node) => {
                const position = positions.get(node.key);
                if (!position) return null;
                const label = node.label;
                const left = GRAPH_PADDING + position.column * (NODE_WIDTH + COLUMN_GAP);
                const top = GRAPH_PADDING + position.row * (NODE_HEIGHT + ROW_GAP);
                const StatusIcon = stateIcon(node.state);
                const ActivityIcon = nodeIcon(node);
                const provider =
                  node.kind === "agent" && node.providerInstanceId !== null
                    ? providersByInstanceId.get(node.providerInstanceId)
                    : undefined;
                const isSelected = selectedNodeKey === node.key;
                const activeTool = node.kind === "agent" ? activeTools.get(node.key) : undefined;
                const statusLabel = activeTool ? `Using ${activeTool}` : node.statusLabel;
                return (
                  <article
                    key={node.key}
                    role="listitem"
                    aria-label={`${label}, ${statusLabel}`}
                    className="absolute z-10 min-h-[5.5rem] w-[12.25rem]"
                    style={{ left, top }}
                    data-run-graph-position={`${left},${top}`}
                  >
                    <button
                      type="button"
                      ref={isSelected ? selectedNodeButtonRef : undefined}
                      aria-label={`${label}, ${statusLabel}`}
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
                        {provider ? (
                          <ProviderInstanceIcon
                            driverKind={provider.driver}
                            displayName={provider.displayName ?? provider.driver}
                            acpRegistryIconUrl={provider.iconUrl}
                            className="z-auto size-4 shrink-0"
                            iconClassName="size-4"
                          />
                        ) : (
                          <ActivityIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusIcon
                          aria-hidden
                          className={`size-3.5 shrink-0 ${STATE_CLASS[node.state]}`}
                        />
                        <span className="truncate">{statusLabel}</span>
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {selectedNode?.kind === "agent" ? (
        <div className="absolute inset-x-2 bottom-8 z-20 max-h-[50%] overflow-y-auto rounded-xl bg-background/95 shadow-lg">
          <RunGraphNodeDetails
            node={selectedNode}
            onOpenChildThread={(threadId: ThreadId) => {
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
              });
            }}
            onClose={() => {
              setSelectedNodeKey(null);
              selectedNodeButtonRef.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
