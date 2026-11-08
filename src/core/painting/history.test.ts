import { describe, expect, it } from 'vitest';
import { brushAction } from './actions';
import {
  UNDO_LIMIT,
  type HistoryState,
  canRedo,
  canUndo,
  createHistory,
  historyDepth,
  pushAction,
  redoAction,
  undoAction,
  visibleActions,
} from './history';

function brush(index: number) {
  return brushAction([{ u: index / 100, v: 0.5 }], {
    size: 24,
    color: '#174a94',
  });
}

function filled(count: number): HistoryState {
  let state = createHistory();
  for (let i = 0; i < count; i++) state = pushAction(state, brush(i));
  return state;
}

describe('painting history', () => {
  it('starts empty', () => {
    const state = createHistory();
    expect(state.actions).toEqual([]);
    expect(state.cursor).toBe(0);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
    expect(visibleActions(state)).toEqual([]);
    expect(historyDepth(state)).toBe(0);
  });

  it('keeps every committed action after a hundred operations', () => {
    const state = filled(100);
    expect(historyDepth(state)).toBe(100);
    expect(state.cursor).toBe(100);
    expect(visibleActions(state)).toHaveLength(100);
    expect(visibleActions(state)[0]).toEqual(brush(0));
  });

  it('discards the redo branch when a new action is pushed after an undo', () => {
    let state = filled(5);
    state = undoAction(state);
    state = undoAction(state);
    expect(state.cursor).toBe(3);
    expect(canRedo(state)).toBe(true);
    state = pushAction(state, brush(99));
    expect(state.cursor).toBe(4);
    expect(historyDepth(state)).toBe(4);
    expect(canRedo(state)).toBe(false);
    expect(visibleActions(state)).toHaveLength(4);
    expect(visibleActions(state)[0]).toEqual(brush(0));
  });

  it('walks back at most twenty steps from the tip', () => {
    let state = filled(25);
    expect(canUndo(state)).toBe(true);
    for (let i = 0; i < UNDO_LIMIT; i++) state = undoAction(state);
    expect(state.cursor).toBe(25 - UNDO_LIMIT);
    expect(canUndo(state)).toBe(false);
    const unchanged = undoAction(state);
    expect(unchanged.cursor).toBe(state.cursor);
    expect(historyDepth(state)).toBe(25);
    expect(visibleActions(state)).toHaveLength(5);
  });

  it('walks back everything when the history is shorter than the limit', () => {
    let state = filled(10);
    for (let i = 0; i < 10; i++) state = undoAction(state);
    expect(state.cursor).toBe(0);
    expect(canUndo(state)).toBe(false);
    expect(visibleActions(state)).toEqual([]);
    expect(historyDepth(state)).toBe(10);
  });

  it('redoes up to the end of the history', () => {
    let state = filled(3);
    state = undoAction(state);
    state = undoAction(state);
    expect(canRedo(state)).toBe(true);
    state = redoAction(state);
    expect(state.cursor).toBe(2);
    state = redoAction(state);
    expect(state.cursor).toBe(3);
    expect(canRedo(state)).toBe(false);
    const unchanged = redoAction(state);
    expect(unchanged.cursor).toBe(3);
    expect(visibleActions(state)).toHaveLength(3);
  });

  it('never mutates the state it is given', () => {
    const state = filled(3);
    const snapshot = JSON.stringify(state);
    const undone = undoAction(state);
    const redone = redoAction(state);
    const pushed = pushAction(state, brush(9));
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(undone.cursor).toBe(2);
    expect(redone.cursor).toBe(3);
    expect(pushed.cursor).toBe(4);
    expect(pushed.actions).not.toBe(state.actions);
  });
});
