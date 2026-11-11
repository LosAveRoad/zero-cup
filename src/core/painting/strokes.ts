import { brushAction, stampAction } from './actions';
import { INKS } from './inks';
import type { StampAssetId } from './stamps';
import type { ChallengeId } from '../challenges/challenges';
import { sampleProfile, VESSEL_BASE_HEIGHT } from '../geometry/profile';
import type {
  PaintingAction,
  ProfileControlPoint,
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
  'imperial_lotus' | 'three_fruits' | 'horse_cup';

export const MASTERPIECE_PRESETS: readonly {
  id: MasterpiecePresetId;
  name: string;
  subtitle: string;
  reference: ChallengeId;
}[] = [
  {
    id: 'imperial_lotus',
    name: '缠枝宝相莲',
    subtitle: '蕉叶束颈，浓淡莲瓣与卷枝铺满瓶腹',
    reference: 'yuhuchun',
  },
  {
    id: 'three_fruits',
    name: '折枝三果',
    subtitle: '桃、石榴与佛手各占一面，仰莲收足',
    reference: 'meiping',
  },
  {
    id: 'horse_cup',
    name: '留白走马',
    subtitle: '双弦纹围住大片留白，两面各绘一马',
    reference: 'yazhbei',
  },
];

export type RotaryPatternId =
  'linked-wave' | 'straight-line' | 'leaf' | 'filled-lotus' | 'key-fret';

export type RotaryPattern = {
  id: RotaryPatternId;
  name: string;
  subtitle: string;
  /** Which seamless, repeatable path is laid out around the vessel. */
  shape: 'wave' | 'line' | 'stamp';
  assetId?: StampAssetId;
};

export const ROTARY_PATTERNS: readonly RotaryPattern[] = [
  {
    id: 'linked-wave',
    name: '连绵水波',
    subtitle: '首尾相接的起伏水线，整圈连续',
    shape: 'wave',
  },
  {
    id: 'straight-line',
    name: '直线环带',
    subtitle: '沿器身画一圈平直线条',
    shape: 'line',
  },
  {
    id: 'leaf',
    name: '叶片连饰',
    subtitle: '按手绘叶形轴对称排列一周',
    shape: 'stamp',
    assetId: 'rotary-leaf',
  },
  {
    id: 'filled-lotus',
    name: '团莲环饰',
    subtitle: '蓝色填面团莲，轴对称连续排列一周',
    shape: 'stamp',
    assetId: 'filled-lotus',
  },
  {
    id: 'key-fret',
    name: '回纹连方',
    subtitle: '方折回纹首尾相扣，构成连续边饰',
    shape: 'stamp',
    assetId: 'blue-key-fret',
  },
];

export const ROTARY_PATTERN_SIZE_RANGE = { min: 0.5, max: 6, step: 0.1 };
// The silhouette metric converts diameter with radius * 20, so one radius
// unit represents 10 cm around the lathe circumference.
const PROFILE_RADIUS_CM = 10;
const PROFILE_HEIGHT_UNIT_CM = 10;

export function rotaryRepeatCount(radius: number, desiredSizeCm: number) {
  return Math.max(
    1,
    Math.floor(
      (2 * Math.PI * Math.max(0, radius) * PROFILE_RADIUS_CM) /
        Math.max(0.1, desiredSizeCm),
    ),
  );
}

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

function rotaryLinePath(
  centerU: number,
  centerV: number,
  segments: number,
): UVPoint[] {
  const steps = Math.max(4, Math.floor(segments));
  const v = clamp01(centerV);
  return Array.from({ length: steps + 1 }, (_, index) => ({
    u: centerU + index / steps,
    v,
  }));
}

function rotaryLineAction(
  centerU: number,
  centerV: number,
  color: string,
  size: number,
  opacity = 1,
  segments = 64,
): PaintingAction {
  return brushAction(rotaryLinePath(centerU, centerV, segments), {
    size,
    color,
    opacity,
  });
}

/**
 * Builds a continuous horizontal potter's wheel ring band ("旋坯弦纹 / 箍线")
 * around the vessel circumference at height `v`.
 */
export function buildRingBandPath(v: number, segments = 16): UVPoint[] {
  return rotaryLinePath(0, v, segments);
}

/** Builds a tiled rotary motif; physical motif width and brush weight share one size scale. */
export function createRotaryPattern(
  id: RotaryPatternId,
  color: string,
  centerU: number,
  centerV: number,
  desiredSizeCm: number,
  profile: ProfileControlPoint[],
  heightScale = 1,
): PaintingAction[] {
  const pattern = ROTARY_PATTERNS.find((item) => item.id === id);
  if (!pattern) throw new Error('Unknown rotary pattern');
  const atHeight = sampleProfile(profile).reduce((nearest, point) =>
    Math.abs(point.height - centerV) < Math.abs(nearest.height - centerV)
      ? point
      : nearest,
  );
  const repeatCount = rotaryRepeatCount(atHeight.radius, desiredSizeCm);
  const motifHeight = Math.min(
    0.22,
    Math.max(
      0.012,
      desiredSizeCm /
        (VESSEL_BASE_HEIGHT * PROFILE_HEIGHT_UNIT_CM * heightScale),
    ),
  );
  // Keep the ink line proportional to each tile's width, so dense small leaves
  // retain visible gaps instead of merging into a row of arches.
  const brushSize = Math.max(
    2,
    Math.min(30, Math.round((TEXTURE_SIZE / repeatCount) * 0.055)),
  );
  const center = wrapU(centerU);
  const startU = center - 0.5 / repeatCount;
  if (pattern.shape === 'line') {
    return [rotaryLineAction(center, centerV, color, brushSize)];
  }
  if (pattern.shape === 'stamp') {
    return [
      stampAction(center, centerV, {
        assetId: pattern.assetId!,
        color,
        footprint: {
          u: (pattern.id === 'leaf' ? 1.04 : 1) / repeatCount,
          v: motifHeight,
        },
        repeatCount,
      }),
    ];
  }
  const points: UVPoint[] = [];
  const stepsPerTile = 32;
  for (let step = 0; step <= repeatCount * stepsPerTile; step++) {
    const progress = step / (repeatCount * stepsPerTile);
    const phase = (progress * repeatCount) % 1;
    const x = startU + progress;
    const baseline = centerV;
    let wave = 0;
    if (pattern.shape === 'wave') wave = Math.sin(phase * Math.PI * 2) * 0.35;
    points.push({ u: x, v: clamp01(baseline + wave * motifHeight) });
  }
  // Keep the loop closed at the UV seam and centre one repeat on the hover point.
  points[points.length - 1] = { u: startU + 1, v: points[0].v };
  return [brushAction(points, { size: brushSize, color })];
}

/** Adapts museum compositions into the same editable actions as hand painting. */
export function createMasterpiecePreset(
  id: MasterpiecePresetId,
  frontU: number,
  profile: ProfileControlPoint[],
  heightScale: number,
): PaintingAction[] {
  const sampled = sampleProfile(profile);
  const segments = sampled.length - 1;
  const ring = (v: number, size: number, ink = INKS[0]) =>
    rotaryLineAction(0, v, ink.value, size, ink.opacity, 16);
  const motif = (
    assetId: StampAssetId,
    v: number,
    maxHeight: number,
    maxWidth: number,
    options: {
      phase?: number;
      symmetry?: SymmetryCount;
      rotation?: number;
    } = {},
  ) => {
    // LatheGeometry distributes V across the same evenly sampled heights.
    // Match one UV unit along the profile to one UV unit around this row.
    const row = v * segments;
    const index = Math.floor(row);
    const lower = sampled[index];
    const upper = sampled[index + 1];
    const radiusChange = upper.radius - lower.radius;
    const radius = lower.radius + radiusChange * (row - index);
    const meridian = Math.hypot(
      VESSEL_BASE_HEIGHT * heightScale,
      radiusChange * segments,
    );
    const aspect = meridian / (TAU * radius);
    const spanV = Math.min(maxHeight, maxWidth / aspect);
    return stampAction(wrapU(frontU + (options.phase ?? 0)), v, {
      assetId,
      color: INKS[0].value,
      footprint: { u: Math.min(maxWidth, spanV * aspect), v: spanV },
      rotation: options.rotation ?? 0,
      ...(options.symmetry ? { repeatCount: options.symmetry } : {}),
    });
  };

  if (id === 'imperial_lotus') {
    return [
      ring(0.967, 14),
      motif('museum-spear', 0.881, 0.16, 0.2, { symmetry: 8 }),
      ring(0.801, 8, INKS[1]),
      motif('museum-fret', 0.763, 0.064, 0.123, { symmetry: 8 }),
      ring(0.725, 13),
      motif('museum-lotus', 0.461, 0.485, 0.495, { symmetry: 2 }),
      motif('museum-lappet', 0.155, 0.105, 0.121, { symmetry: 8 }),
      ring(0.093, 11, INKS[1]),
      ring(0.07, 13),
    ];
  }
  if (id === 'three_fruits') {
    return [
      ring(0.94, 15),
      motif('museum-lappet', 0.849, 0.142, 0.12, {
        symmetry: 8,
        rotation: Math.PI,
      }),
      ring(0.765, 9, INKS[1]),
      motif('museum-pomegranate', 0.525, 0.445, 0.31),
      motif('museum-peach', 0.525, 0.445, 0.31, { phase: 1 / 3 }),
      motif('museum-citron', 0.525, 0.445, 0.31, { phase: 2 / 3 }),
      ring(0.28, 9, INKS[1]),
      motif('museum-lappet', 0.173, 0.168, 0.121, { symmetry: 8 }),
      ring(0.078, 14),
    ];
  }
  return [
    ring(0.958, 15),
    ring(0.904, 9, INKS[1]),
    motif('museum-horse', 0.515, 0.5, 0.32, { symmetry: 2 }),
    ring(0.134, 9, INKS[1]),
    ring(0.089, 13),
  ];
}
