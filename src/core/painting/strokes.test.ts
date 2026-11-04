import { expect, it } from 'vitest';
import { appendStroke, splitSegment } from './strokes';
it('splits both seam directions without drawing across the texture', () => {
  const forward = splitSegment({ u: 0.95, v: 0.4 }, { u: 0.05, v: 0.6 });
  expect(forward).toHaveLength(2);
  expect(forward[0][1].u).toBe(1);
  expect(forward[1][0].u).toBe(0);
  expect(forward[0][1].v).toBeCloseTo(0.5);
  expect(splitSegment({ u: 0.05, v: 0.6 }, { u: 0.95, v: 0.4 })[0][1].u).toBe(
    0,
  );
  expect(splitSegment({ u: 0.2, v: 0.4 }, { u: 0.3, v: 0.5 })).toHaveLength(1);
});
it('new drawing after undo discards redo while retaining all earlier commands', () => {
  const line = { points: [{ u: 0.5, v: 0.5 }], size: 24, color: '#174a94' };
  const initial = Array.from({ length: 25 }, () => line);
  const result = appendStroke(initial, 23, line);
  expect(result).toHaveLength(24);
  expect(initial).toHaveLength(25);
});
