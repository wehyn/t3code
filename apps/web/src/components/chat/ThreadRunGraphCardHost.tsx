import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Grip, GripVerticalIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { observeResize } from "../../lib/observeResize";
import { useRunGraphSelection, type ActiveRunGraphSelection } from "../../runGraphSelection";
import { Button } from "../ui/button";
import {
  selectRunGraphCardState,
  RUN_GRAPH_MAX_ZOOM,
  RUN_GRAPH_MIN_ZOOM,
  RUN_GRAPH_ZOOM_STEP,
  useRunGraphCardStore,
  type RunGraphCanvasPan,
  type RunGraphCanvasView,
  type RunGraphCardSize,
} from "../../runGraphCardStore";
import { ThreadRunGraphSection } from "./ThreadRunGraphSection";

const CARD_MARGIN = 16;
const DEFAULT_CARD_SIZE = 300;
const MIN_CARD_SIZE = 300;
const EMPTY_SUBAGENT_KEYS: ReadonlyArray<string> = [];

function clampSize(size: RunGraphCardSize): RunGraphCardSize {
  const maxSize = Math.max(
    1,
    Math.min(window.innerWidth - CARD_MARGIN * 2, window.innerHeight - CARD_MARGIN * 2),
  );
  const minSize = Math.min(MIN_CARD_SIZE, maxSize);
  const edge = Math.round(Math.max(minSize, Math.min(Math.max(size.width, size.height), maxSize)));
  return {
    width: edge,
    height: edge,
  };
}

function clampPosition(
  position: { readonly x: number; readonly y: number },
  card: HTMLElement,
): { x: number; y: number } {
  const rect = card.getBoundingClientRect();
  return {
    x: Math.max(CARD_MARGIN, Math.min(position.x, window.innerWidth - rect.width - CARD_MARGIN)),
    y: Math.max(CARD_MARGIN, Math.min(position.y, window.innerHeight - rect.height - CARD_MARGIN)),
  };
}

function defaultPosition(card: HTMLElement): { x: number; y: number } {
  const width =
    card.getBoundingClientRect().width ||
    Math.min(DEFAULT_CARD_SIZE, window.innerWidth - CARD_MARGIN * 2);
  return clampPosition({ x: window.innerWidth - width - 24, y: 88 }, card);
}

function writePosition(card: HTMLElement, position: { readonly x: number; readonly y: number }) {
  card.style.left = `${position.x}px`;
  card.style.top = `${position.y}px`;
}

function writeSize(card: HTMLElement, size: RunGraphCardSize) {
  card.style.width = `${size.width}px`;
  card.style.height = `${size.height}px`;
}

function RunGraphCard({
  threadRef,
  threadKey,
  selection,
}: {
  threadRef: ScopedThreadRef;
  threadKey: string;
  selection: ActiveRunGraphSelection;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    startWidth: number;
    startHeight: number;
    startX: number;
    startY: number;
  } | null>(null);
  const position = useRunGraphCardStore(
    (state) => selectRunGraphCardState(state.byThreadKey, threadRef).position,
  );
  const size = useRunGraphCardStore(
    (state) => selectRunGraphCardState(state.byThreadKey, threadRef).size,
  );
  const zoom = useRunGraphCardStore(
    (state) => selectRunGraphCardState(state.byThreadKey, threadRef).zoom,
  );
  const pan = useRunGraphCardStore(
    (state) => selectRunGraphCardState(state.byThreadKey, threadRef).pan,
  );
  const seenSubagentKeys = useRunGraphCardStore((state) => {
    const cardState = selectRunGraphCardState(state.byThreadKey, threadRef);
    return cardState.autoFitRunId === selection.run.id
      ? cardState.autoFittedSubagentKeys
      : EMPTY_SUBAGENT_KEYS;
  });
  const savedPositionRef = useRef(position);
  const savedSizeRef = useRef(size);
  const currentPositionRef = useRef<{ x: number; y: number } | null>(null);
  const { environmentId, threadId } = threadRef;

  useLayoutEffect(() => {
    savedPositionRef.current = position;
  }, [position]);

  useLayoutEffect(() => {
    savedSizeRef.current = size;
  }, [size]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const scopedRef = { environmentId, threadId };
    const applyBounds = () => {
      if (resizeRef.current) return;
      const savedSize = savedSizeRef.current;
      const nextSize = clampSize(
        savedSize ?? { width: DEFAULT_CARD_SIZE, height: DEFAULT_CARD_SIZE },
      );
      writeSize(card, nextSize);
      const saved = savedPositionRef.current;
      const next = clampPosition(
        saved ?? currentPositionRef.current ?? defaultPosition(card),
        card,
      );
      currentPositionRef.current = next;
      writePosition(card, next);
      if (
        savedSize === null ||
        savedSize.width !== nextSize.width ||
        savedSize.height !== nextSize.height ||
        saved?.x !== next.x ||
        saved?.y !== next.y
      ) {
        savedSizeRef.current = nextSize;
        savedPositionRef.current = next;
        useRunGraphCardStore.getState().resize(scopedRef, nextSize, next);
      } else if (saved && (saved.x !== next.x || saved.y !== next.y)) {
        useRunGraphCardStore.getState().move(scopedRef, next);
      }
    };
    applyBounds();
    const stopObserving = observeResize(card, applyBounds);
    window.addEventListener("resize", applyBounds);
    return () => {
      stopObserving();
      window.removeEventListener("resize", applyBounds);
    };
  }, [environmentId, threadId]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button,[data-no-drag]"))
    )
      return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: rect.left,
      startY: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const card = cardRef.current;
    if (!drag || !card || drag.pointerId !== event.pointerId) return;
    const next = clampPosition(
      {
        x: drag.startX + event.clientX - drag.pointerX,
        y: drag.startY + event.clientY - drag.pointerY,
      },
      card,
    );
    currentPositionRef.current = next;
    writePosition(card, next);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const card = cardRef.current;
    if (!drag || !card || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const rect = card.getBoundingClientRect();
    const next = clampPosition({ x: rect.left, y: rect.top }, card);
    currentPositionRef.current = next;
    savedPositionRef.current = next;
    writePosition(card, next);
    useRunGraphCardStore.getState().move(threadRef, next);
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startX: rect.left,
      startY: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const resizeCard = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    const card = cardRef.current;
    if (!gesture || !card || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.pointerX;
    const deltaY = event.clientY - gesture.pointerY;
    const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    const nextSize = clampSize({
      width: gesture.startWidth + delta,
      height: gesture.startHeight + delta,
    });
    writeSize(card, nextSize);
    const nextPosition = clampPosition({ x: gesture.startX, y: gesture.startY }, card);
    currentPositionRef.current = nextPosition;
    writePosition(card, nextPosition);
    event.preventDefault();
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    const card = cardRef.current;
    if (!gesture || !card || gesture.pointerId !== event.pointerId) return;
    resizeCard(event);
    resizeRef.current = null;
    const rect = card.getBoundingClientRect();
    const nextSize = clampSize({ width: rect.width, height: rect.height });
    const nextPosition = clampPosition({ x: rect.left, y: rect.top }, card);
    writeSize(card, nextSize);
    writePosition(card, nextPosition);
    savedSizeRef.current = nextSize;
    savedPositionRef.current = nextPosition;
    useRunGraphCardStore.getState().resize(threadRef, nextSize, nextPosition);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const step = event.shiftKey ? 48 : 16;
    const deltaX = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const deltaY = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (deltaX === 0 && deltaY === 0) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const delta = deltaX === 0 ? deltaY : deltaX;
    const nextSize = clampSize({
      width: rect.width + delta,
      height: rect.height + delta,
    });
    writeSize(card, nextSize);
    const nextPosition = clampPosition({ x: rect.left, y: rect.top }, card);
    writePosition(card, nextPosition);
    currentPositionRef.current = nextPosition;
    savedSizeRef.current = nextSize;
    savedPositionRef.current = nextPosition;
    useRunGraphCardStore.getState().resize(threadRef, nextSize, nextPosition);
  };

  return createPortal(
    <section
      ref={cardRef}
      className="dropdown-glass isolate fixed z-[80] flex max-h-[calc(100dvh-2rem)] w-[min(18.75rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-xl"
      style={{ left: CARD_MARGIN, top: CARD_MARGIN }}
      aria-label="Run graph"
      data-thread-run-graph-card={threadKey}
    >
      <div
        className="flex h-9 shrink-0 touch-none items-center justify-between border-b border-border/65 px-2 text-muted-foreground cursor-grab active:cursor-grabbing"
        role="group"
        aria-label="Move run graph card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
        <div className="flex items-center gap-1" role="group" aria-label="Graph zoom controls">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom out"
            disabled={zoom <= RUN_GRAPH_MIN_ZOOM}
            onClick={() => useRunGraphCardStore.getState().zoomBy(threadRef, -RUN_GRAPH_ZOOM_STEP)}
          >
            <ZoomOutIcon aria-hidden="true" className="size-4" />
          </Button>
          <span data-no-drag className="min-w-9 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom in"
            disabled={zoom >= RUN_GRAPH_MAX_ZOOM}
            onClick={() => useRunGraphCardStore.getState().zoomBy(threadRef, RUN_GRAPH_ZOOM_STEP)}
          >
            <ZoomInIcon aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Close run graph"
            onClick={() => useRunGraphCardStore.getState().dismiss(threadRef, selection.run.id)}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ThreadRunGraphSection
          selection={selection}
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          zoom={zoom}
          pan={pan}
          onPanChange={(nextPan: RunGraphCanvasPan) =>
            useRunGraphCardStore.getState().panTo(threadRef, nextPan)
          }
          onViewChange={(view: RunGraphCanvasView) =>
            useRunGraphCardStore.getState().setView(threadRef, view)
          }
          seenSubagentKeys={seenSubagentKeys}
          onSubagentsSeen={(keys: ReadonlyArray<string>) =>
            useRunGraphCardStore.getState().markSubagentsSeen(threadRef, selection.run.id, keys)
          }
        />
      </div>
      <button
        type="button"
        aria-label="Resize run graph card"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        className="absolute bottom-1 right-1 z-20 flex size-6 touch-none cursor-nwse-resize items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onPointerDown={beginResize}
        onPointerMove={resizeCard}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeByKeyboard}
      >
        <Grip aria-hidden="true" className="size-4" />
      </button>
    </section>,
    document.body,
  );
}

export function ThreadRunGraphCardHost(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const threadKey = scopedThreadKey(threadRef);
  const selection = useRunGraphSelection(threadRef);
  const dismissedRunId = useRunGraphCardStore(
    (state) => selectRunGraphCardState(state.byThreadKey, threadRef).dismissedRunId,
  );
  const runIsActive = selection.kind === "active";
  const graphIsOpen = selection.kind === "active" && dismissedRunId !== selection.run.id;
  const statusText = runIsActive
    ? "Agents active"
    : selection.kind === "loading"
      ? "Checking agents"
      : "No active agents";
  const accessibleLabel = runIsActive
    ? `${statusText}. ${graphIsOpen ? "Hide" : "Show"} agent graph.`
    : statusText;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!runIsActive}
        aria-label={accessibleLabel}
        aria-pressed={graphIsOpen}
        onClick={() => {
          if (selection.kind !== "active") return;
          if (graphIsOpen) {
            useRunGraphCardStore.getState().dismiss(threadRef, selection.run.id);
          } else {
            useRunGraphCardStore.getState().reopen(threadRef, selection.run.id);
          }
        }}
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${runIsActive ? "bg-success" : "bg-muted-foreground/40"}`}
        />
        {statusText}
      </Button>
      {selection.kind === "active" && graphIsOpen ? (
        <RunGraphCard
          key={threadKey}
          threadRef={threadRef}
          threadKey={threadKey}
          selection={selection}
        />
      ) : null}
    </>
  );
}
