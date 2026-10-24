import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { GripVerticalIcon, XIcon } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { observeResize } from "../../lib/observeResize";
import { Button } from "../ui/button";
import { selectRunGraphCardState, useRunGraphCardStore } from "../../runGraphCardStore";
import { ThreadRunGraphSection } from "./ThreadRunGraphSection";

const CARD_MARGIN = 16;
const DEFAULT_CARD_WIDTH = 544;

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
    Math.min(DEFAULT_CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2);
  return clampPosition({ x: window.innerWidth - width - 24, y: 88 }, card);
}

function writePosition(card: HTMLElement, position: { readonly x: number; readonly y: number }) {
  card.style.left = `${position.x}px`;
  card.style.top = `${position.y}px`;
}

function RunGraphCard({
  threadRef,
  threadKey,
  workspaceRoot,
}: {
  threadRef: ScopedThreadRef;
  threadKey: string;
  workspaceRoot?: string | undefined;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const position = useRunGraphCardStore((state) =>
    selectRunGraphCardState(state.byThreadKey, threadRef).position,
  );
  const savedPositionRef = useRef(position);
  savedPositionRef.current = position;
  const currentPositionRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const applyPosition = () => {
      const saved = savedPositionRef.current;
      const next = clampPosition(
        saved ?? currentPositionRef.current ?? defaultPosition(card),
        card,
      );
      currentPositionRef.current = next;
      writePosition(card, next);
      if (saved && (saved.x !== next.x || saved.y !== next.y)) {
        useRunGraphCardStore.getState().move(threadRef, next);
      }
    };
    applyPosition();
    const stopObserving = observeResize(card, applyPosition);
    window.addEventListener("resize", applyPosition);
    return () => {
      stopObserving();
      window.removeEventListener("resize", applyPosition);
    };
  }, [threadRef]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button")))
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
    writePosition(card, next);
    useRunGraphCardStore.getState().move(threadRef, next);
  };

  return createPortal(
    <section
      ref={cardRef}
      className="dropdown-glass isolate fixed z-[80] flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-xl"
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
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close run graph"
          onClick={() => useRunGraphCardStore.getState().close(threadRef)}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ThreadRunGraphSection
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          workspaceRoot={workspaceRoot}
        />
      </div>
    </section>,
    document.body,
  );
}

export function ThreadRunGraphCardHost(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  workspaceRoot?: string | undefined;
}) {
  const threadRef = useMemo(
    () => ({ environmentId: props.environmentId, threadId: props.threadId }),
    [props.environmentId, props.threadId],
  );
  const threadKey = scopedThreadKey(threadRef);
  const open = useRunGraphCardStore((state) =>
    selectRunGraphCardState(state.byThreadKey, threadRef).open,
  );
  if (!open) return null;
  return (
    <RunGraphCard
      key={threadKey}
      threadRef={threadRef}
      threadKey={threadKey}
      workspaceRoot={props.workspaceRoot}
    />
  );
}
