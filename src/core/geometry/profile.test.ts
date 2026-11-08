import { describe, expect, it } from 'vitest';
import type { ProfileControlPoint } from '../../types/artwork';
import {
  PROFILE_LIMITS,
  createProfile,
  createTemplateProfile,
  moveControlPoint,
  normalizeProfile,
  sampleProfile,
  validateProfile,
  type ProfileTemplateId,
} from './profile';

const TEMPLATE_IDS: ProfileTemplateId[] = ['bottle', 'meiping', 'cup', 'melon'];

function profileOf(
  radii: number[],
  heights?: number[],
  ids?: string[],
): ProfileControlPoint[] {
  return radii.map((radius, i) => ({
    id: ids?.[i] ?? `point-${i}`,
    height: heights?.[i] ?? i / (radii.length - 1),
    radius,
  }));
}

/** The two control points that enclose a sampled height. */
function neighbours(
  points: ProfileControlPoint[],
  height: number,
): [ProfileControlPoint, ProfileControlPoint] {
  let i = 0;
  while (i < points.length - 2 && points[i + 1].height < height) i++;
  return [points[i], points[i + 1]];
}

describe('profile defaults and limits', () => {
  it('keeps the baseline eight point outline', () => {
    const points = createProfile();
    expect(points).toHaveLength(8);
    expect(points.map((p) => p.id)).toEqual([
      'point-0',
      'point-1',
      'point-2',
      'point-3',
      'point-4',
      'point-5',
      'point-6',
      'point-7',
    ]);
    expect(points.map((p) => p.height)).toEqual([
      0,
      1 / 7,
      2 / 7,
      3 / 7,
      4 / 7,
      5 / 7,
      6 / 7,
      1,
    ]);
    expect(() => validateProfile(points)).not.toThrow();
  });

  it('publishes the documented limits and keeps the baseline maximum radius', () => {
    expect(PROFILE_LIMITS.maxRadius).toBe(0.9);
    expect(PROFILE_LIMITS.minRadius).toBe(0.08);
    expect(PROFILE_LIMITS.minHeightGap).toBe(0.05);
    expect(PROFILE_LIMITS.minPoints).toBe(6);
    expect(PROFILE_LIMITS.maxPoints).toBe(10);
  });

  it('builds templates that satisfy every limit', () => {
    for (const kind of TEMPLATE_IDS) {
      const points = createTemplateProfile(kind);
      expect(points.length).toBeGreaterThanOrEqual(PROFILE_LIMITS.minPoints);
      expect(points.length).toBeLessThanOrEqual(PROFILE_LIMITS.maxPoints);
      expect(() => validateProfile(points)).not.toThrow();
      expect(points[0].height).toBe(PROFILE_LIMITS.minHeight);
      expect(points.at(-1)!.height).toBe(PROFILE_LIMITS.maxHeight);
      for (const point of points) {
        expect(point.radius).toBeGreaterThanOrEqual(PROFILE_LIMITS.minRadius);
        expect(point.radius).toBeLessThanOrEqual(PROFILE_LIMITS.maxRadius);
      }
    }
  });

  it('rejects an unknown template', () => {
    expect(() => createTemplateProfile('missing' as ProfileTemplateId)).toThrow(
      'Unknown profile template',
    );
  });
});

describe('profile validation', () => {
  it('rejects a profile with too few or too many points', () => {
    expect(() => validateProfile([])).toThrow('Invalid profile size');
    expect(() => validateProfile(profileOf([0.3, 0.4, 0.5, 0.4, 0.3]))).toThrow(
      'Invalid profile size',
    );
    expect(() =>
      validateProfile(profileOf(Array.from({ length: 11 }, () => 0.4))),
    ).toThrow('Invalid profile size');
  });

  it('rejects radii and heights outside the supported range', () => {
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4], undefined, undefined),
      ),
    ).not.toThrow();
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.05]).map((p, i) =>
          i === 3 ? { ...p, radius: 0.05 } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4]).map((p, i) =>
          i === 2 ? { ...p, radius: 0.95 } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4]).map((p, i) =>
          i === 2 ? { ...p, radius: NaN } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4]).map((p, i) =>
          i === 1 ? { ...p, height: -0.1 } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4]).map((p, i) =>
          i === 1 ? { ...p, height: 1.4 } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4]).map((p, i) =>
          i === 1 ? { ...p, height: NaN } : p,
        ),
      ),
    ).toThrow('Invalid profile point');
  });

  it('rejects neighbouring heights that are too close', () => {
    expect(() =>
      validateProfile(
        profileOf([0.3, 0.4, 0.5, 0.6, 0.5, 0.4], [0, 0.02, 0.4, 0.6, 0.8, 1]),
      ),
    ).toThrow('Invalid profile point');
  });

  it('rejects profiles that do not span the whole height', () => {
    expect(() =>
      validateProfile(
        profileOf(
          [0.3, 0.4, 0.5, 0.6, 0.5, 0.4],
          [0.01, 0.2, 0.4, 0.6, 0.8, 1],
        ),
      ),
    ).toThrow('Profile endpoints must span [0,1]');
    expect(() =>
      validateProfile(
        profileOf(
          [0.3, 0.4, 0.5, 0.6, 0.5, 0.4],
          [0, 0.2, 0.4, 0.6, 0.8, 0.99],
        ),
      ),
    ).toThrow('Profile endpoints must span [0,1]');
  });
});

describe('spline sampling', () => {
  it('samples the requested number of points with increasing heights', () => {
    const points = createProfile();
    const sampled = sampleProfile(points);
    expect(sampled).toHaveLength(65);
    expect(sampled[0]).toEqual({ radius: points[0].radius, height: 0 });
    expect(sampled[64].height).toBe(1);
    expect(sampled.at(-1)!.radius).toBe(points.at(-1)!.radius);
    for (let i = 1; i < sampled.length; i++)
      expect(sampled[i].height).toBeGreaterThan(sampled[i - 1].height);
  });

  it('honours a custom segment count', () => {
    expect(sampleProfile(createProfile(), 8)).toHaveLength(9);
    expect(sampleProfile(createProfile(), 1)).toHaveLength(2);
  });

  it('rejects an invalid segment count', () => {
    expect(() => sampleProfile(createProfile(), 0)).toThrow(
      'Invalid profile size',
    );
    expect(() => sampleProfile(createProfile(), 2.5)).toThrow(
      'Invalid profile size',
    );
  });

  it('rejects malformed profiles rather than rendering broken geometry', () => {
    expect(() => sampleProfile([])).toThrow();
    expect(() =>
      sampleProfile(createProfile().map((p) => ({ ...p, radius: NaN }))),
    ).toThrow();
    expect(() =>
      sampleProfile(createProfile().map((p) => ({ ...p, radius: 0.95 }))),
    ).toThrow('Invalid profile point');
    expect(() =>
      sampleProfile(createProfile().map((p) => ({ ...p, radius: 0.05 }))),
    ).toThrow('Invalid profile point');
  });

  it('rejects profiles that do not cover the whole normalized height', () => {
    const bottom = createProfile();
    bottom[0].height = 0.01;
    expect(() => sampleProfile(bottom)).toThrow('endpoints');
    const top = createProfile();
    top[7].height = 0.99;
    expect(() => sampleProfile(top)).toThrow('endpoints');
  });

  it('never overshoots the radii of the neighbouring control points', () => {
    const cases: ProfileControlPoint[][] = [
      createProfile(),
      profileOf([0.08, 0.9, 0.09, 0.88, 0.1, 0.2, 0.3]),
      profileOf([0.9, 0.08, 0.9, 0.08, 0.9, 0.08, 0.5]),
      profileOf([0.3, 0.3, 0.3, 0.7, 0.7, 0.7]),
      profileOf([0.5, 0.9, 0.1, 0.9, 0.1, 0.5]),
      ...TEMPLATE_IDS.map((kind) => createTemplateProfile(kind)),
    ];
    for (const points of cases) {
      const sampled = sampleProfile(points, 128);
      for (const sample of sampled) {
        const [a, b] = neighbours(points, sample.height);
        const low = Math.min(a.radius, b.radius);
        const high = Math.max(a.radius, b.radius);
        expect(sample.radius).toBeGreaterThanOrEqual(low - 1e-12);
        expect(sample.radius).toBeLessThanOrEqual(high + 1e-12);
        expect(sample.radius).toBeGreaterThanOrEqual(
          PROFILE_LIMITS.minRadius - 1e-12,
        );
        expect(sample.radius).toBeLessThanOrEqual(
          PROFILE_LIMITS.maxRadius + 1e-12,
        );
      }
    }
  });

  it('produces a smooth curve instead of straight segments', () => {
    const points = createProfile();
    const segments = 64;
    const sampled = sampleProfile(points, segments);
    // The spline must differ from the linear interpolation of the control
    // points, otherwise the outline would still be faceted.
    const linear = points.map((p) => ({ ...p }));
    let deviation = 0;
    for (let i = 1; i < linear.length; i++) {
      const mid = (linear[i - 1].height + linear[i].height) / 2;
      const expected = (linear[i - 1].radius + linear[i].radius) / 2;
      const actual = sampled.find(
        (s) => Math.abs(s.height - mid) < 1 / segments,
      )!.radius;
      deviation = Math.max(deviation, Math.abs(actual - expected));
    }
    expect(deviation).toBeGreaterThan(1e-4);
  });

  it('passes exactly through every control point', () => {
    const points = createProfile();
    // 63 * 7 samples land exactly on the default heights i/7.
    const dense = sampleProfile(points, 63 * 7);
    for (const point of points) {
      const hit = dense.find((s) => s.height === point.height);
      expect(hit).toBeDefined();
      expect(hit!.radius).toBeCloseTo(point.radius, 12);
    }
  });

  it('keeps the curve continuous across the control points', () => {
    const points = createProfile();
    const sampled = sampleProfile(points, 256);
    for (let i = 1; i < sampled.length; i++) {
      const step = sampled[i].radius - sampled[i - 1].radius;
      expect(step).toBeLessThan(0.2);
    }
  });

  it('does not let a flat segment drift away from its neighbours', () => {
    const points = profileOf([0.4, 0.4, 0.4, 0.4, 0.4, 0.4]);
    const sampled = sampleProfile(points);
    for (const sample of sampled) expect(sample.radius).toBeCloseTo(0.4, 12);
  });

  it('keeps a monotone radius monotone', () => {
    const points = profileOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const sampled = sampleProfile(points, 32);
    for (let i = 1; i < sampled.length; i++)
      expect(sampled[i].radius).toBeGreaterThanOrEqual(sampled[i - 1].radius);
  });
});

describe('profile normalisation', () => {
  it('clamps values and sorts the heights ascending', () => {
    const normalized = normalizeProfile([
      { id: 'b', height: 0.8, radius: 1.4 },
      { id: 'a', height: -0.2, radius: 0.01 },
      { id: 'c', height: 0.5, radius: 0.5 },
    ]);
    expect(normalized.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    for (const point of normalized) {
      expect(point.radius).toBeGreaterThanOrEqual(PROFILE_LIMITS.minRadius);
      expect(point.radius).toBeLessThanOrEqual(PROFILE_LIMITS.maxRadius);
      expect(point.height).toBeGreaterThanOrEqual(PROFILE_LIMITS.minHeight);
      expect(point.height).toBeLessThanOrEqual(PROFILE_LIMITS.maxHeight);
    }
  });

  it('guarantees the minimum gap between neighbours', () => {
    const normalized = normalizeProfile([
      { id: 'a', height: 0, radius: 0.3 },
      { id: 'b', height: 0.01, radius: 0.3 },
      { id: 'c', height: 0.02, radius: 0.3 },
      { id: 'd', height: 1, radius: 0.3 },
    ]);
    for (let i = 1; i < normalized.length; i++)
      expect(
        normalized[i].height - normalized[i - 1].height,
      ).toBeGreaterThanOrEqual(PROFILE_LIMITS.minHeightGap);
  });

  it('returns an empty list for an empty input', () => {
    expect(normalizeProfile([])).toEqual([]);
  });

  it('handles a single point', () => {
    expect(normalizeProfile([{ id: 'a', height: 0.5, radius: 0.3 }])).toEqual([
      { id: 'a', height: 0.5, radius: 0.3 },
    ]);
  });

  it('spreads points that share the same height', () => {
    const normalized = normalizeProfile(
      Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`,
        height: 0.5,
        radius: 0.3,
      })),
    );
    for (let i = 1; i < normalized.length; i++)
      expect(normalized[i].height).toBeGreaterThan(normalized[i - 1].height);
  });

  it('does not mutate the input', () => {
    const input = [
      { id: 'a', height: 0.8, radius: 1.4 },
      { id: 'b', height: 0.2, radius: 0.2 },
    ];
    const copy = input.map((p) => ({ ...p }));
    normalizeProfile(input);
    expect(input).toEqual(copy);
  });
});

describe('moving a control point', () => {
  it('moves the radius of an inner point', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'point-2', { radius: 0.7 });
    expect(moved[2].radius).toBe(0.7);
    expect(moved[2].height).toBe(points[2].height);
    expect(moved[1]).toEqual(points[1]);
  });

  it('clamps the radius into the supported range', () => {
    const points = createProfile();
    expect(moveControlPoint(points, 'point-2', { radius: 5 })[2].radius).toBe(
      PROFILE_LIMITS.maxRadius,
    );
    expect(moveControlPoint(points, 'point-2', { radius: 0 })[2].radius).toBe(
      PROFILE_LIMITS.minRadius,
    );
  });

  it('keeps the radius when no radius is given', () => {
    const points = createProfile();
    expect(moveControlPoint(points, 'point-2', { height: 0.3 })[2].radius).toBe(
      points[2].radius,
    );
    expect(moveControlPoint(points, 'point-2', {})[2].radius).toBe(
      points[2].radius,
    );
  });

  it('keeps the endpoints pinned to height 0 and 1', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'point-0', {
      height: 0.4,
      radius: 0.4,
    });
    expect(moved[0].height).toBe(0);
    expect(moved[0].radius).toBe(0.4);
    const top = moveControlPoint(points, 'point-7', {
      height: 0.6,
      radius: 0.4,
    });
    expect(top[7].height).toBe(1);
    expect(top[7].radius).toBe(0.4);
  });

  it('keeps the minimum gap to the neighbours', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'point-3', { height: 0.9 });
    expect(moved[3].height - moved[2].height).toBeGreaterThanOrEqual(
      PROFILE_LIMITS.minHeightGap,
    );
    expect(moved[4].height - moved[3].height).toBeGreaterThanOrEqual(
      PROFILE_LIMITS.minHeightGap,
    );
  });

  it('clamps a height that would break the ordering', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'point-3', { height: 0.01 });
    expect(moved[3].height).toBeCloseTo(points[2].height + 0.05, 12);
    expect(() => validateProfile(moved)).not.toThrow();
  });

  it('keeps the height when the neighbours leave no legal gap', () => {
    // Neighbours closer than 0.1 cannot host a legal height at all, so the
    // point keeps its current height instead of breaking the ordering.
    const broken = profileOf(
      [0.3, 0.4, 0.5, 0.6, 0.5, 0.4],
      [0, 0.04, 0.08, 0.5, 0.7, 1],
    );
    const moved = moveControlPoint(broken, 'point-1', { height: 0.9 });
    expect(moved[1].height).toBe(broken[1].height);
  });

  it('ignores a non finite height or radius', () => {
    const points = createProfile();
    expect(moveControlPoint(points, 'point-3', { height: NaN })[3].height).toBe(
      points[3].height,
    );
    expect(moveControlPoint(points, 'point-3', { radius: NaN })[3].radius).toBe(
      points[3].radius,
    );
  });

  it('returns a new array and leaves the input untouched', () => {
    const points = createProfile();
    const copy = points.map((p) => ({ ...p }));
    const moved = moveControlPoint(points, 'point-3', { radius: 0.33 });
    expect(moved).not.toBe(points);
    expect(points).toEqual(copy);
    expect(moved).not.toBe(points);
  });

  it('returns an unchanged copy for an unknown id', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'nope', { radius: 0.33 });
    expect(moved).toEqual(points);
    expect(moved).not.toBe(points);
  });

  it('keeps the profile valid after an extreme drag', () => {
    const points = createProfile();
    const moved = moveControlPoint(points, 'point-3', {
      height: 99,
      radius: 99,
    });
    expect(() => validateProfile(moved)).not.toThrow();
    const sampled = sampleProfile(moved);
    for (const sample of sampled)
      expect(sample.radius).toBeGreaterThanOrEqual(PROFILE_LIMITS.minRadius);
  });
});
