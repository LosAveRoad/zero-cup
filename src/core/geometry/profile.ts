import type { ProfileControlPoint } from '../../types/artwork';

/**
 * Normalised limits of the lathe outline.
 * Heights are fractions of the vessel height (0 = foot, 1 = rim) and radii are
 * fractions of the maximum radius. The maximum radius keeps the baseline 0.9 so
 * artworks that were already stored stay inside the same envelope.
 */
export const PROFILE_LIMITS = {
  minRadius: 0.08,
  maxRadius: 0.9,
  minHeight: 0,
  maxHeight: 1,
  minHeightGap: 0.05,
  minPoints: 6,
  maxPoints: 10,
} as const;

export type ProfileTemplateId = 'bottle' | 'meiping' | 'cup' | 'melon';

export interface SampledProfilePoint {
  radius: number;
  height: number;
}

export interface VesselMetrics {
  footRadius: number;
  bellyRadius: number;
  bellyHeight: number;
  mouthRadius: number;
  slenderness: number;
  volumeMl: number;
  stabilityScore: number;
}

/** Preset silhouettes; bottle/meiping/cup match the three challenge targets. */
const TEMPLATE_RADII: Record<ProfileTemplateId, readonly number[]> = {
  bottle: [0.22, 0.34, 0.52, 0.56, 0.4, 0.2, 0.17, 0.26],
  meiping: [0.2, 0.3, 0.42, 0.54, 0.62, 0.56, 0.26, 0.15],
  cup: [0.3, 0.4, 0.48, 0.54, 0.58, 0.62, 0.66, 0.7],
  melon: [0.28, 0.46, 0.6, 0.64, 0.56, 0.46, 0.36, 0.28],
};

const TEMPLATE_KEYS: readonly ProfileTemplateId[] = [
  'bottle',
  'meiping',
  'cup',
  'melon',
];

/**
 * Slack used when comparing heights. A sum such as `0.3 + 0.05` can land a
 * fraction below the limit, which would make a valid profile fail its own
 * validation.
 */
const HEIGHT_TOLERANCE = 1e-9;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Baseline default profile: eight fixed heights, ids 'point-0'..'point-7'. */
export function createProfile(): ProfileControlPoint[] {
  return [0.35, 0.48, 0.57, 0.6, 0.53, 0.36, 0.25, 0.3].map((radius, i) => ({
    id: `point-${i}`,
    height: i / 7,
    radius,
  }));
}

/** A preset outline that already satisfies every limit. */
export function createTemplateProfile(
  kind: ProfileTemplateId,
): ProfileControlPoint[] {
  const radii = TEMPLATE_RADII[kind];
  if (!radii) throw new Error('Unknown profile template');
  return radii.map((radius, i) => ({
    id: `point-${i}`,
    height: i / (radii.length - 1),
    radius,
  }));
}

/**
 * Returns the template id whose control points match `points`, or `''` when
 * the outline has been customized or reset to the default profile.
 */
export function matchTemplateId(
  points: ProfileControlPoint[],
): ProfileTemplateId | '' {
  for (const kind of TEMPLATE_KEYS) {
    const radii = TEMPLATE_RADII[kind];
    if (points.length !== radii.length) continue;
    const matches = points.every((point, index) => {
      const expectedHeight = index / (radii.length - 1);
      return (
        Math.abs(point.height - expectedHeight) <= 1e-6 &&
        Math.abs(point.radius - radii[index]) <= 1e-6
      );
    });
    if (matches) return kind;
  }
  return '';
}

/** Throws when the outline could not be turned into a valid lathe profile. */
export function validateProfile(points: ProfileControlPoint[]): void {
  if (
    points.length < PROFILE_LIMITS.minPoints ||
    points.length > PROFILE_LIMITS.maxPoints
  )
    throw new Error('Invalid profile size');
  points.forEach((p, i) => {
    if (
      !Number.isFinite(p.radius) ||
      p.radius < PROFILE_LIMITS.minRadius ||
      p.radius > PROFILE_LIMITS.maxRadius
    )
      throw new Error('Invalid profile point');
    if (
      !Number.isFinite(p.height) ||
      p.height < PROFILE_LIMITS.minHeight ||
      p.height > PROFILE_LIMITS.maxHeight
    )
      throw new Error('Invalid profile point');
    if (
      i > 0 &&
      p.height - points[i - 1].height <
        PROFILE_LIMITS.minHeightGap - HEIGHT_TOLERANCE
    )
      throw new Error('Invalid profile point');
  });
  if (
    points[0].height !== PROFILE_LIMITS.minHeight ||
    points.at(-1)!.height !== PROFILE_LIMITS.maxHeight
  )
    throw new Error('Profile endpoints must span [0,1]');
}

/**
 * Fritsch–Carlson tangents.
 * Secant slopes are averaged into tangents and every interval is then clamped
 * onto the monotone circle (alpha, beta >= 0 and alpha^2 + beta^2 <= 9), the
 * classical sufficient condition for a cubic Hermite that never overshoots the
 * two radii of its own interval.
 */
function monotoneTangents(points: ProfileControlPoint[]): number[] {
  const count = points.length;
  const secants: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const span = points[i + 1].height - points[i].height;
    secants.push((points[i + 1].radius - points[i].radius) / span);
  }
  const tangents: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) tangents[i] = secants[0];
    else if (i === count - 1) tangents[i] = secants[count - 2];
    else tangents[i] = (secants[i - 1] + secants[i]) / 2;
  }
  for (let i = 0; i < count - 1; i++) {
    const delta = secants[i];
    if (delta === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    let alpha = tangents[i] / delta;
    let beta = tangents[i + 1] / delta;
    if (alpha < 0) alpha = 0;
    if (beta < 0) beta = 0;
    const norm = alpha * alpha + beta * beta;
    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      alpha *= tau;
      beta *= tau;
    }
    tangents[i] = alpha * delta;
    tangents[i + 1] = beta * delta;
  }
  return tangents;
}

/** Radius of the monotone spline at an arbitrary height. */
function radiusAt(
  points: ProfileControlPoint[],
  tangents: number[],
  height: number,
): number {
  const last = points.length - 1;
  if (height <= points[0].height) return points[0].radius;
  if (height >= points[last].height) return points[last].radius;
  let i = 0;
  while (i < last - 1 && points[i + 1].height < height) i++;
  const a = points[i];
  const b = points[i + 1];
  const span = b.height - a.height;
  const t = (height - a.height) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return (
    h00 * a.radius +
    h10 * span * tangents[i] +
    h01 * b.radius +
    h11 * span * tangents[i + 1]
  );
}

/**
 * Smooth constrained sampling of the outline.
 * The curve is a monotone cubic Hermite (Fritsch–Carlson) spline over
 * (height, radius); between two neighbouring control points the radius can
 * never leave [min(r_a, r_b), max(r_a, r_b)], so the lathe mesh stays valid.
 */
export function sampleProfile(
  points: ProfileControlPoint[],
  segments = 64,
): SampledProfilePoint[] {
  if (!Number.isInteger(segments) || segments < 1)
    throw new Error('Invalid profile size');
  validateProfile(points);
  const tangents = monotoneTangents(points);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const height = i / segments;
    return { radius: radiusAt(points, tangents, height), height };
  });
}

/**
 * Repairs an arbitrary outline: radii and heights are clamped into the
 * supported range, the heights are sorted ascending and the minimum gap
 * between two neighbours is guaranteed.
 */
export function normalizeProfile(
  points: ProfileControlPoint[],
): ProfileControlPoint[] {
  if (points.length === 0) return [];
  const sorted = points
    .map((p) => ({
      id: p.id,
      radius: clamp(
        p.radius,
        PROFILE_LIMITS.minRadius,
        PROFILE_LIMITS.maxRadius,
      ),
      height: clamp(
        p.height,
        PROFILE_LIMITS.minHeight,
        PROFILE_LIMITS.maxHeight,
      ),
    }))
    .sort((a, b) => a.height - b.height);
  const count = sorted.length;
  if (count === 1) return sorted;
  const gap = Math.min(
    PROFILE_LIMITS.minHeightGap,
    PROFILE_LIMITS.maxHeight / (count - 1),
  );
  const first = sorted[0].height;
  const last = sorted[count - 1].height;
  const span = Math.max(0, PROFILE_LIMITS.maxHeight - (count - 1) * gap);
  const range = last - first;
  return sorted.map((point, i) => {
    const ratio =
      range < HEIGHT_TOLERANCE
        ? i / (count - 1)
        : (point.height - first) / range;
    return {
      ...point,
      height: clamp(ratio * span + i * gap, 0, PROFILE_LIMITS.maxHeight),
    };
  });
}

/**
 * Moves one control point and clamps the result so every limit still holds.
 * The first and the last point stay pinned to height 0 and 1.
 */
export function moveControlPoint(
  points: ProfileControlPoint[],
  id: string,
  next: { height?: number; radius?: number },
): ProfileControlPoint[] {
  const index = points.findIndex((p) => p.id === id);
  const moved = points.map((p) => ({ ...p }));
  if (index < 0) return moved;
  const current = moved[index];
  const radius = clamp(
    Number.isFinite(next.radius) ? (next.radius as number) : current.radius,
    PROFILE_LIMITS.minRadius,
    PROFILE_LIMITS.maxRadius,
  );
  let height = current.height;
  if (index === 0) height = PROFILE_LIMITS.minHeight;
  else if (index === points.length - 1) height = PROFILE_LIMITS.maxHeight;
  else if (Number.isFinite(next.height)) {
    const lower = moved[index - 1].height + PROFILE_LIMITS.minHeightGap;
    const upper = moved[index + 1].height - PROFILE_LIMITS.minHeightGap;
    height =
      lower > upper
        ? current.height
        : clamp(next.height as number, lower, upper);
  }
  moved[index] = { ...current, height, radius };
  return moved;
}

/**
 * Computes physical and geometric indicators for the vessel outline using
 * trapezoidal integration over the sampled monotone spline.
 */
export function computeVesselMetrics(
  points: ProfileControlPoint[],
): VesselMetrics {
  const sampled = sampleProfile(points, 64);
  const footRadius = sampled[0].radius;
  const mouthRadius = sampled[sampled.length - 1].radius;
  let bellyRadius = footRadius;
  let bellyHeight = 0;
  let areaIntegral = 0;
  let momentIntegral = 0;
  for (let i = 0; i < sampled.length; i++) {
    const sample = sampled[i];
    if (sample.radius > bellyRadius) {
      bellyRadius = sample.radius;
      bellyHeight = sample.height;
    }
    if (i > 0) {
      const prev = sampled[i - 1];
      const dh = sample.height - prev.height;
      const r2Avg =
        0.5 * (prev.radius * prev.radius + sample.radius * sample.radius);
      const hAvg = 0.5 * (prev.height + sample.height);
      areaIntegral += r2Avg * dh;
      momentIntegral += hAvg * r2Avg * dh;
    }
  }
  const centerOfMass = momentIntegral / areaIntegral;
  const slenderness = Number((1 / (2 * bellyRadius)).toFixed(2));
  const volumeMl = Math.round(Math.PI * areaIntegral * 750);
  const stabilityScore = Math.round(
    clamp((footRadius / bellyRadius) * 65 + (1 - centerOfMass) * 65, 25, 99),
  );
  return {
    footRadius,
    bellyRadius,
    bellyHeight,
    mouthRadius,
    slenderness,
    volumeMl,
    stabilityScore,
  };
}
