import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export interface RunGraphCardPosition {
  readonly x: number;
  readonly y: number;
}

export interface RunGraphCardState {
  readonly open: boolean;
  readonly position: RunGraphCardPosition | null;
}

interface RunGraphCardStore {
  readonly byThreadKey: Record<string, RunGraphCardState>;
  open: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  move: (ref: ScopedThreadRef, position: RunGraphCardPosition) => void;
}

const DEFAULT_RUN_GRAPH_CARD_STATE: RunGraphCardState = { open: true, position: null };

export function selectRunGraphCardState(
  byThreadKey: Record<string, RunGraphCardState>,
  ref: ScopedThreadRef,
): RunGraphCardState {
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
}

export const useRunGraphCardStore = create<RunGraphCardStore>((set) => ({
  byThreadKey: {},
  open: (ref) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, open: true } } };
    }),
  close: (ref) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, open: false } } };
    }),
  move: (ref, position) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const current = state.byThreadKey[key] ?? DEFAULT_RUN_GRAPH_CARD_STATE;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...current, position } } };
    }),
}));
