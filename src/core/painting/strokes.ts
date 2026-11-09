import { brushAction, stampAction } from './actions';
import type {
  PaintingAction,
  SymmetryCount,
  UVPoint,
} from '../../types/artwork';

/** The painting layer is a fixed 2048×2048 canvas. */
export const TEXTURE_SIZE = 2048;

export const SYMMETRY_OPTIONS: readonly {
  count: SymmetryCount;
  name: string;
}[] = [
  { count: 1, name: '单笔自由' },
  { count: 2, name: '双面对称' },
  { count: 4, name: '四方开光' },
  { count: 6, name: '六瓣团花' },
  { count: 8, name: '八方万花' },
];

export type MasterpiecePresetId =
  'imperial_lotus' | 'cloud_collar' | 'classic_bands';

export const MASTERPIECE_PRESETS: readonly {
  id: MasterpiecePresetId;
  name: string;
  subtitle: string;
}[] = [
  {
    id: 'imperial_lotus',
    name: '缠枝宝相莲',
    subtitle: '六方缠枝莲与海水江崖通景',
  },
  {
    id: 'cloud_collar',
    name: '四方云肩纹',
    subtitle: '如意云头开光配团花雅制',
  },
  {
    id: 'classic_bands',
    name: '宋韵青花弦',
    subtitle: '浓淡分水箍线与折枝莲纹',
  },
];

/**
 * Two samples closer than this (in uv units, i.e. ~5 texture pixels) describe
 * the same dab of ink and are merged into one.
 */
export const MIN_POINT_DISTANCE = 0.0025;

/**
 * A segment whose |Δu| is larger than this is treated as a jump across the
 * U=0/U=1 seam instead of a stroke travelling around the vessel.
 */
export const SEAM_SPLIT_THRESHOLD = 0.5;

const TAU = Math.PI * 2;

/**
 * back-compat alias: the legacy v1 stroke shape still persisted by schema v1.
 * Structurally identical to `LegacyStroke` in `src/types/artwork.ts`.
 */
export type Stroke = { points: UVPoint[]; size: number; color: string };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function distance(a: UVPoint, b: UVPoint): number {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/**
 * Shortest signed angular difference between two azimuths, in (-PI, PI].
 *
 * Positive means "the azimuth grew", negative means "it shrank". The result is
 * never exactly -PI, so a caller can always add it to `previous` and stay in
 * the same continuous branch.
 */
export function shortestAngleDelta(previous: number, next: number): number {
  let delta = (next - previous) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta <= -Math.PI) delta += TAU;
  // `-0` and `0` must compare equal for the callers below.
  return delta === 0 ? 0 : delta;
}

/**
 * Unwrap an azimuth (radians) so it stays continuous with the previous
 * azimuth: the returned value is the branch of `nextTheta` that is closest to
 * `previousTheta` instead of the principal (-PI, PI] branch.
 */
export function unwrapTheta(previousTheta: number, nextTheta: number): number {
  return previousTheta + shortestAngleDelta(previousTheta, nextTheta);
}

/**
 * Convert an azimuth (radians) into the seam-relative u coordinate in [0,1).
 *
 * `seamAngle` is the azimuth of the U=0 seam; it defaults to 0, which matches
 * THREE.LatheGeometry (uv.x = phi / 2PI with phi = atan2(x, z)).
 */
export function azimuthToU(theta: number, seamAngle = 0): number {
  return wrapU((theta - seamAngle) / TAU);
}

/** Normalize any u into [0,1). */
export function wrapU(u: number): number {
  const wrapped = u % 1;
  if (wrapped < 0) return wrapped + 1;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Splits one path segment that jumps across the seam into two segments that
 * stay inside the texture.
 *
 * A raw u jump is ambiguous: it can be a stroke that crossed the seam or a
 * fast stroke that travelled across the visible front. The renderer removes
 * that ambiguity by sampling the pointer's *azimuth* and accumulating a
 * continuous u with `unwrapTheta` / `azimuthToU`; `splitSegment` therefore
 * stays the safety net for legacy v1 paths (which contain a raw jump) and for
 * pathological single-frame jumps.
 *
 * The convention matches the historical behaviour: a negative Δu is read as a
 * forward crossing (the stroke runs up to U=1 and continues at U=0), a
 * positive Δu as a backward crossing (down to U=0 and continues at U=1).
 * Segments whose |Δu| is exactly 1 or larger never produce NaN.
 */
export function splitSegment(a: UVPoint, b: UVPoint): [UVPoint, UVPoint][] {
  const delta = b.u - a.u;
  if (Math.abs(delta) <= SEAM_SPLIT_THRESHOLD) return [[a, b]];
  const forward = delta < 0;
  // Where the stroke really ends once the seam is unwrapped.
  const unwrappedEnd = forward ? b.u + 1 : b.u - 1;
  const edge = forward ? 1 : 0;
  const denominator = unwrappedEnd - a.u;
  // A jump of exactly one full turn has no denominator; fall back to the
  // middle of the segment so the result stays finite.
  const ratio = denominator === 0 ? 0.5 : (edge - a.u) / denominator;
  const t = Math.min(1, Math.max(0, ratio));
  const v = a.v + (b.v - a.v) * t;
  return [
    [
      { u: a.u, v: a.v },
      { u: edge, v },
    ],
    [
      { u: forward ? 0 : 1, v },
      { u: wrapU(b.u), v: b.v },
    ],
  ];
}

/**
 * Legacy helper: appends a stroke to the list of strokes at `cursor` and
 * discards whatever was redoable. Kept for the v1 stroke list; new code
 * should use the history module instead.
 */
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

/**
 * Removes near-duplicate points and clamps u/v into [0,1].
 *
 * Use it on legacy v1 paths, whose samples are already normalized. Do not use
 * it on an unwrapped continuous path: clamping u into [0,1] would destroy the
 * "slightly outside [0,1]" representation of a seam crossing.
 */
export function mergePath(points: UVPoint[]): UVPoint[] {
  const merged: UVPoint[] = [];
  for (const point of points) {
    const clamped = { u: clamp01(point.u), v: clamp01(point.v) };
    const last = merged[merged.length - 1];
    if (last && distance(last, clamped) < MIN_POINT_DISTANCE) continue;
    merged.push(clamped);
  }
  return merged;
}

/**
 * Appends a point to a path.
 *
 * The new point is unwrapped so it stays continuous with the previous one: it
 * may end up slightly outside [0,1] — that is intentional and is how a seam
 * crossing is represented without a long line across the texture. Points
 * closer than `MIN_POINT_DISTANCE` are dropped.
 */
export function extendPath(points: UVPoint[], next: UVPoint): UVPoint[] {
  const last = points[points.length - 1];
  if (!last) return [{ u: next.u, v: clamp01(next.v) }];
  // Shift by the nearest whole turn so the new sample stays next to the
  // previous one instead of jumping across the seam.
  const delta = next.u - last.u;
  const candidate = {
    u: last.u + (delta - Math.round(delta)),
    v: clamp01(next.v),
  };
  if (distance(last, candidate) < MIN_POINT_DISTANCE) return points.slice();
  return [...points, candidate];
}

/**
 * Integer x-offsets (in texture pixels) needed to draw a path that may span a
 * seam.
 *
 * The path is expected to be continuous in u, so it may start slightly below
 * 0 or end slightly above 1. The returned offsets shift the whole path so
 * that every visible part lands inside the texture; the neighbours of the
 * strict range are included so that a thick brush keeps a continuous edge
 * where the stroke touches U=0 or U=1.
 */
export function drawOffsets(
  points: UVPoint[],
  textureSize = TEXTURE_SIZE,
): number[] {
  if (points.length === 0) return [0];
  let minU = Infinity;
  let maxU = -Infinity;
  for (const point of points) {
    if (point.u < minU) minU = point.u;
    if (point.u > maxU) maxU = point.u;
  }
  const low = Math.min(-Math.floor(maxU), -1);
  const high = Math.max(-Math.floor(minU), 1);
  const offsets: number[] = [];
  for (let k = low; k <= high; k++) offsets.push(k * textureSize);
  return offsets;
}

/**
 * Replicates a continuous UV stroke path into `symmetry` equally spaced
 * azimuthal copies around the circumference while preserving unwrapped seam
 * deltas within each copy.
 */
export function replicatePathBySymmetry(
  points: UVPoint[],
  symmetry: SymmetryCount = 1,
): UVPoint[][] {
  if (points.length === 0) return [];
  const firstU = points[0].u;
  const result: UVPoint[][] = [];
  for (let k = 0; k < symmetry; k++) {
    const phase = k / symmetry;
    const baseU = wrapU(firstU + phase);
    const shift = baseU - firstU;
    result.push(
      points.map((point) => ({
        u: point.u + shift,
        v: clamp01(point.v),
      })),
    );
  }
  return result;
}

/**
 * Replicates a single UV point into `symmetry` equally spaced azimuthal copies.
 */
export function replicatePointBySymmetry(
  point: UVPoint,
  symmetry: SymmetryCount = 1,
): UVPoint[] {
  const v = clamp01(point.v);
  return Array.from({ length: symmetry }, (_, k) => ({
    u: wrapU(point.u + k / symmetry),
    v,
  }));
}

/**
 * Builds a continuous horizontal potter's wheel ring band ("旋坯弦纹 / 箍线")
 * around the vessel circumference at height `v`.
 */
export function buildRingBandPath(v: number, segments = 16): UVPoint[] {
  const clampedV = clamp01(v);
  const steps = Math.max(4, Math.floor(segments));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    u: i / steps,
    v: clampedV,
  }));
}

/**
 * Generates a curated sequence of blue-and-white porcelain painting commands
 * combining potter's wheel collar rings and radial symmetric motifs.
 */
export function createMasterpiecePreset(
  id: MasterpiecePresetId,
): PaintingAction[] {
  if (id === 'imperial_lotus') {
    return [
      brushAction(buildRingBandPath(0.88), {
        size: 14,
        color: '#174a94',
        opacity: 1,
      }),
      brushAction(buildRingBandPath(0.84), {
        size: 8,
        color: '#547fb2',
        opacity: 0.78,
      }),
      stampAction(0.08, 0.72, {
        assetId: 'cloud',
        color: '#547fb2',
        scale: 0.85,
        rotation: 0,
        symmetry: 6,
      }),
      stampAction(0, 0.48, {
        assetId: 'lotus',
        color: '#174a94',
        scale: 1.15,
        rotation: 0,
        symmetry: 6,
      }),
      stampAction(0.06, 0.22, {
        assetId: 'seaside',
        color: '#174a94',
        scale: 0.95,
        rotation: 0,
        symmetry: 8,
      }),
      brushAction(buildRingBandPath(0.1), {
        size: 14,
        color: '#174a94',
        opacity: 1,
      }),
    ];
  }
  if (id === 'cloud_collar') {
    return [
      brushAction(buildRingBandPath(0.9), {
        size: 12,
        color: '#174a94',
        opacity: 1,
      }),
      stampAction(0, 0.76, {
        assetId: 'cloud',
        color: '#174a94',
        scale: 1.1,
        rotation: Math.PI,
        symmetry: 4,
      }),
      brushAction(buildRingBandPath(0.62), {
        size: 8,
        color: '#9ab6d5',
        opacity: 0.55,
      }),
      stampAction(0.125, 0.45, {
        assetId: 'lotus',
        color: '#547fb2',
        scale: 1.05,
        rotation: 0,
        symmetry: 4,
      }),
      stampAction(0, 0.2, {
        assetId: 'seaside',
        color: '#174a94',
        scale: 0.9,
        rotation: 0,
        symmetry: 6,
      }),
      brushAction(buildRingBandPath(0.08), {
        size: 12,
        color: '#174a94',
        opacity: 1,
      }),
    ];
  }
  return [
    brushAction(buildRingBandPath(0.86), {
      size: 10,
      color: '#174a94',
      opacity: 1,
    }),
    brushAction(buildRingBandPath(0.82), {
      size: 20,
      color: '#9ab6d5',
      opacity: 0.55,
    }),
    brushAction(buildRingBandPath(0.56), {
      size: 10,
      color: '#547fb2',
      opacity: 0.78,
    }),
    stampAction(0.25, 0.46, {
      assetId: 'lotus',
      color: '#174a94',
      scale: 1,
      rotation: 0,
      symmetry: 2,
    }),
    brushAction(buildRingBandPath(0.36), {
      size: 10,
      color: '#547fb2',
      opacity: 0.78,
    }),
    brushAction(buildRingBandPath(0.12), {
      size: 16,
      color: '#174a94',
      opacity: 1,
    }),
  ];
}
