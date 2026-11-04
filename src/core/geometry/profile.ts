import type { ProfileControlPoint } from '../../types/artwork';

export function createProfile(): ProfileControlPoint[] {
  return [0.35, 0.48, 0.57, 0.6, 0.53, 0.36, 0.25, 0.3].map((radius, i) => ({
    id: `point-${i}`,
    height: i / 7,
    radius,
  }));
}

/** Baseline uses bounded linear interpolation; a smooth spline is a follow-up. */
export function sampleProfile(points: ProfileControlPoint[], segments = 64) {
  if (
    points.length < 6 ||
    points.length > 10 ||
    segments < 1 ||
    !Number.isInteger(segments)
  )
    throw new Error('Invalid profile size');
  points.forEach((p, i) => {
    if (
      !Number.isFinite(p.radius) ||
      p.radius < 0.08 ||
      p.radius > 0.9 ||
      !Number.isFinite(p.height) ||
      p.height < 0 ||
      p.height > 1 ||
      (i > 0 && p.height - points[i - 1].height < 0.05)
    )
      throw new Error('Invalid profile point');
  });
  if (points[0].height !== 0 || points.at(-1)!.height !== 1)
    throw new Error('Profile endpoints must span [0,1]');
  return Array.from({ length: segments + 1 }, (_, i) => {
    const height = i / segments;
    let j = 1;
    while (j < points.length - 1 && points[j].height < height) j++;
    const a = points[j - 1],
      b = points[j];
    const t = (height - a.height) / (b.height - a.height);
    return { radius: a.radius + (b.radius - a.radius) * t, height };
  });
}
