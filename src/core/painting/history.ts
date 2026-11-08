import type { PaintingAction } from '../../types/artwork';

/**
 * The undo window: at most this many steps can be walked back from the tip of
 * the history. The committed actions themselves are never dropped — the limit
 * only bounds how far the user may step back.
 */
export const UNDO_LIMIT = 20;

export interface HistoryState {
  /** Every committed action, oldest first. */
  actions: PaintingAction[];
  /** How many of them are currently painted. */
  cursor: number;
}

/** An empty history. */
export function createHistory(): HistoryState {
  return { actions: [], cursor: 0 };
}

/**
 * Appends an action, discarding any redo branch.
 *
 * The actions before the cursor are kept untouched, so a picture survives any
 * number of undos: the history is never truncated to `UNDO_LIMIT` entries.
 */
export function pushAction(
  state: HistoryState,
  action: PaintingAction,
): HistoryState {
  return {
    actions: [...state.actions.slice(0, state.cursor), action],
    cursor: state.cursor + 1,
  };
}

/** The oldest cursor the undo window can still reach. */
function undoFloor(state: HistoryState): number {
  return Math.max(0, state.actions.length - UNDO_LIMIT);
}

/** True when one more action can be stepped back. */
export function canUndo(state: HistoryState): boolean {
  return state.cursor > undoFloor(state);
}

/** True when one more action can be stepped forward. */
export function canRedo(state: HistoryState): boolean {
  return state.cursor < state.actions.length;
}

/**
 * Steps back one action, but never further than `UNDO_LIMIT` steps from the
 * tip. Returns the state unchanged when there is nothing to undo.
 */
export function undoAction(state: HistoryState): HistoryState {
  if (!canUndo(state)) return state;
  return { actions: [...state.actions], cursor: state.cursor - 1 };
}

/** Steps forward one action, never past the end. */
export function redoAction(state: HistoryState): HistoryState {
  if (!canRedo(state)) return state;
  return { actions: [...state.actions], cursor: state.cursor + 1 };
}

/**
 * The actions that are currently painted: `actions.slice(0, cursor)`.
 *
 * The earliest strokes therefore stay visible while undos are pending.
 */
export function visibleActions(state: HistoryState): PaintingAction[] {
  return state.actions.slice(0, state.cursor);
}

/** Total number of committed actions. */
export function historyDepth(state: HistoryState): number {
  return state.actions.length;
}
