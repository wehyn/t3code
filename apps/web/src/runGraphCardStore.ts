import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { OrchestrationV2Run, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export interface RunGraphCardPosition {
  readonly x: number;
  readonly y: number;
}

export interface RunGraphCanvasPan {
  readonly x: number;
  readonly y: number;
}

export interface RunGraphCanvasView {
  readonly zoom: number;
  readonly pan: RunGraphCanvasPan;
}

export interface RunGraphCardSize {
  readonly width: number;
  readonly height: number;
}

export const RUN_GRAPH_MIN_ZOOM = 0.2;
export const RUN_GRAPH_MAX_ZOOM = 2;
export const RUN_GRAPH_ZOOM_STEP = 0.1;

export interface RunGraphCardState {
  readonly dismissedRunId: OrchestrationV2Run["id"] | null;
  readonly position: RunGraphCardPosition | null;
  readonly size: RunGraphCardSize | null;
  readonly zoom: number;
  readonly pan: RunGraphCanvasPan | null;
  readonly autoFitRunId: OrchestrationV2Run["id"] | null;
  readonly autoFittedSubagentKeys: ReadonlyArray<string>;
}

interface RunGraphCardStore {
  readonly byThreadKey: Record<string, RunGraphCardState>;
  dismiss: (ref: ScopedThreadRef, runId: OrchestrationV2Run["id"]) => void;
  reopen: (ref: ScopedThreadRef, runId: OrchestrationV2Run["id"]) => void;
  zoomBy: (ref: ScopedThreadRef, delta: number) => void;
  panTo: (ref: ScopedThreadRef, pan: RunGraphCanvasPan) => void;
  setView: (ref: ScopedThreadRef, view: RunGraphCanvasView) => void;
  markSubagentsSeen: (
    ref: ScopedThreadRef,
    runId: OrchestrationV2Run["id"],
    keys: ReadonlyArray<string>,
  ) => void;
  move: (ref: ScopedThreadRef, position: RunGraphCardPosition) => void;
  resize: (ref: ScopedThreadRef, size: RunGraphCardSize, position: RunGraphCardPosition) => void;
}

const DEFAULT_RUN_GRAPH_CARD_STATE: RunGraphCardState = {
  dismissedRunId: null,
  position: null,
  size: null,
  zoom: 1,
  pan: null,
  autoFitRunId: null,
  autoFittedSubagentKeys: [],
};

export function selectRunGraphCardState(
  byThreadKey: Record<string, RunGraphCardState>,
  ref: ScopedThreadRef,
): RunGraphCardState {
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
}

export const useRunGraphCardStore = create<RunGraphCardStore>((set) => ({
  byThreadKey: {},
  dismiss: (ref, runId) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return {
        byThreadKey: { ...state.byThreadKey, [key]: { ...current, dismissedRunId: runId } },
      };
    }),
  reopen: (ref, runId) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      if (current.dismissedRunId !== runId) return state;
      return {
        byThreadKey: { ...state.byThreadKey, [key]: { ...current, dismissedRunId: null } },
      };
    }),
  zoomBy: (ref, delta) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      const zoom = Math.min(
        RUN_GRAPH_MAX_ZOOM,
        Math.max(
          RUN_GRAPH_MIN_ZOOM,
          Math.round((current.zoom + delta) / RUN_GRAPH_ZOOM_STEP) * RUN_GRAPH_ZOOM_STEP,
        ),
      );
      if (zoom === current.zoom) return state;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, zoom } } };
    }),
  panTo: (ref, pan) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      if (current.pan !== null && current.pan.x === pan.x && current.pan.y === pan.y) return state;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, pan } } };
    }),
  setView: (ref, view) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      if (
        current.zoom === view.zoom &&
        current.pan?.x === view.pan.x &&
        current.pan?.y === view.pan.y
      ) {
        return state;
      }
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [key]: { ...current, zoom: view.zoom, pan: view.pan },
        },
      };
    }),
  markSubagentsSeen: (ref, runId, keys) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      const existing = current.autoFitRunId === runId ? current.autoFittedSubagentKeys : [];
      const seen = new Set(existing);
      for (const subagentKey of keys) seen.add(subagentKey);
      if (current.autoFitRunId === runId && seen.size === existing.length) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [key]: {
            ...current,
            autoFitRunId: runId,
            autoFittedSubagentKeys: [...seen],
          },
        },
      };
    }),
  move: (ref, position) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, position } } };
    }),
  resize: (ref, size, position) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, size, position } } };
    }),
}));
