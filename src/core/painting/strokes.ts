import type { UVPoint } from '../../types/artwork';
export interface Stroke {
  points: UVPoint[];
  size: number;
  color: string;
}
export function appendStroke(
  strokes: Stroke[],
  cursor: number,
  stroke: Stroke,
): Stroke[] {
  return [
    ...strokes.slice(0, cursor),
    { ...stroke, points: stroke.points.map((p) => ({ ...p })) },
  ];
}
export function splitSegment(a: UVPoint, b: UVPoint): [UVPoint, UVPoint][] {
  const delta = b.u - a.u;
  if (Math.abs(delta) <= 0.8) return [[a, b]];
  const end = delta < 0 ? 1 : 0;
  const wrapped = b.u + (delta < 0 ? 1 : -1);
  const t = (end - a.u) / (wrapped - a.u);
  const v = a.v + (b.v - a.v) * t;
  return [
    [a, { u: end, v }],
    [{ u: 1 - end, v }, b],
  ];
}
