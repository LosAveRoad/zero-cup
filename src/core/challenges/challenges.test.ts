import { describe, expect, it } from 'vitest';
import type { ProfileControlPoint } from '../../types/artwork';
import {
  CHALLENGES,
  getChallenge,
  scoreLabel,
  scoreStars,
  silhouetteScore,
} from './challenges';

const PROFILE_LIMITS = {
  minRadius: 0.08,
  maxRadius: 0.9,
  minGap: 0.05,
  minPoints: 6,
  maxPoints: 10,
};

function isValidOutline(points: ProfileControlPoint[]): boolean {
  if (points.length < PROFILE_LIMITS.minPoints) return false;
  if (points.length > PROFILE_LIMITS.maxPoints) return false;
  if (points[0].height !== 0) return false;
  if (points[points.length - 1].height !== 1) return false;
  return points.every((point, index) => {
    if (!Number.isFinite(point.radius)) return false;
    if (point.radius < PROFILE_LIMITS.minRadius) return false;
    if (point.radius > PROFILE_LIMITS.maxRadius) return false;
    if (index === 0) return true;
    return point.height - points[index - 1].height >= PROFILE_LIMITS.minGap;
  });
}

/** Local sampler so the test does not depend on the geometry module. */
function sampleRadius(points: ProfileControlPoint[], height: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (height <= first.height) return first.radius;
  if (height >= last.height) return last.radius;
  let i = 1;
  while (i < points.length - 1 && points[i].height < height) i += 1;
  const lower = points[i - 1];
  const upper = points[i];
  const t = (height - lower.height) / (upper.height - lower.height);
  return lower.radius + (upper.radius - lower.radius) * t;
}

function radiusCurve(points: ProfileControlPoint[], samples = 64): number[] {
  return Array.from({ length: samples }, (_, i) =>
    sampleRadius(points, i / (samples - 1)),
  );
}

function cylinder(radius: number): ProfileControlPoint[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    id: `point-${i}`,
    height: i / 7,
    radius,
  }));
}

describe('challenge catalogue', () => {
  it('ships the three PRD challenges in a fixed order', () => {
    expect(CHALLENGES).toHaveLength(3);
    expect(CHALLENGES.map((challenge) => challenge.id)).toEqual([
      'yuhuchun',
      'meiping',
      'yazhbei',
    ]);
    expect(CHALLENGES.map((challenge) => challenge.name)).toEqual([
      '玉壶春瓶',
      '梅瓶',
      '压手杯',
    ]);
  });

  it('describes every challenge with a sentence and a shaping hint', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.description.length).toBeGreaterThan(4);
      expect(challenge.hint.length).toBeGreaterThan(4);
    }
  });

  it('only ships outlines the shaping stage accepts', () => {
    for (const challenge of CHALLENGES) {
      expect(isValidOutline(challenge.profile)).toBe(true);
    }
  });

  it('keeps the three target silhouettes visually distinguishable', () => {
    const curves = CHALLENGES.map((challenge) =>
      radiusCurve(challenge.profile),
    );
    expect(curves[0]).not.toEqual(curves[1]);
    expect(curves[0]).not.toEqual(curves[2]);
    expect(curves[1]).not.toEqual(curves[2]);
    expect(
      silhouetteScore(CHALLENGES[0].profile, CHALLENGES[1].profile),
    ).toBeLessThan(100);
    expect(
      silhouetteScore(CHALLENGES[0].profile, CHALLENGES[2].profile),
    ).toBeLessThan(100);
    expect(
      silhouetteScore(CHALLENGES[1].profile, CHALLENGES[2].profile),
    ).toBeLessThan(100);
  });
});

describe('getChallenge', () => {
  it('returns the matching definition', () => {
    expect(getChallenge('yuhuchun')).toBe(CHALLENGES[0]);
    expect(getChallenge('meiping')).toBe(CHALLENGES[1]);
    expect(getChallenge('yazhbei')).toBe(CHALLENGES[2]);
  });

  it('returns undefined for an unknown id', () => {
    expect(getChallenge('nope')).toBeUndefined();
    expect(getChallenge('')).toBeUndefined();
  });
});

describe('silhouetteScore', () => {
  it('gives a perfect score to an outline that matches the target', () => {
    for (const challenge of CHALLENGES) {
      expect(silhouetteScore(challenge.profile, challenge.profile)).toBe(100);
    }
  });

  it('scores a wrong outline clearly below an almost correct one', () => {
    const target = CHALLENGES[0].profile;
    const almost = target.map((point) => ({
      ...point,
      radius: point.radius + 0.01,
    }));
    const wrong = cylinder(0.45);
    const almostScore = silhouetteScore(almost, target);
    const wrongScore = silhouetteScore(wrong, target);
    expect(almostScore).toBeGreaterThan(90);
    expect(wrongScore).toBeLessThan(60);
    expect(wrongScore).toBeLessThan(almostScore - 20);
  });

  it('always returns an integer between 0 and 100', () => {
    const target = CHALLENGES[0].profile;
    const candidates = [
      target,
      cylinder(0.45),
      cylinder(0.9),
      cylinder(0.08),
      target.map((point) => ({ ...point, radius: point.radius * 3 })),
    ];
    for (const user of candidates) {
      const score = silhouetteScore(user, target);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('is symmetric and stable for the same pair of outlines', () => {
    const target = CHALLENGES[1].profile;
    const user = cylinder(0.35);
    const forward = silhouetteScore(user, target);
    expect(silhouetteScore(target, user)).toBe(forward);
    expect(silhouetteScore(user, target)).toBe(forward);
  });

  it('accepts a custom sample count without leaving the 0-100 range', () => {
    const target = CHALLENGES[2].profile;
    expect(silhouetteScore(target, target, 8)).toBe(100);
    expect(silhouetteScore(cylinder(0.4), target, 8)).toBeGreaterThanOrEqual(0);
    expect(silhouetteScore(cylinder(0.4), target, 1)).toBeGreaterThanOrEqual(0);
    expect(silhouetteScore(cylinder(0.4), target, 1000)).toBeGreaterThanOrEqual(
      0,
    );
    expect(silhouetteScore(cylinder(0.4), target, Number.NaN)).toBeGreaterThan(
      0,
    );
  });

  it('returns 0 when either outline is missing or broken', () => {
    const target = CHALLENGES[0].profile;
    expect(silhouetteScore([], target)).toBe(0);
    expect(silhouetteScore(target, [])).toBe(0);
    const broken = target.map((point) => ({ ...point, radius: Number.NaN }));
    expect(silhouetteScore(broken, target)).toBe(0);
  });
});

describe('scoreLabel', () => {
  it('names each evaluation band', () => {
    expect(scoreLabel(100)).toBe('形神兼备');
    expect(scoreLabel(90)).toBe('形神兼备');
    expect(scoreLabel(89)).toBe('风韵初具');
    expect(scoreLabel(75)).toBe('风韵初具');
    expect(scoreLabel(74)).toBe('形似而神未至');
    expect(scoreLabel(60)).toBe('形似而神未至');
    expect(scoreLabel(59)).toBe('尚需打磨');
    expect(scoreLabel(0)).toBe('尚需打磨');
  });

  it('clamps out-of-range and broken scores', () => {
    expect(scoreLabel(150)).toBe('形神兼备');
    expect(scoreLabel(-20)).toBe('尚需打磨');
    expect(scoreLabel(Number.NaN)).toBe('尚需打磨');
  });
});

describe('scoreStars', () => {
  it('awards 0 to 3 stars per band', () => {
    expect(scoreStars(100)).toBe(3);
    expect(scoreStars(90)).toBe(3);
    expect(scoreStars(89)).toBe(2);
    expect(scoreStars(75)).toBe(2);
    expect(scoreStars(74)).toBe(1);
    expect(scoreStars(60)).toBe(1);
    expect(scoreStars(59)).toBe(0);
    expect(scoreStars(0)).toBe(0);
  });

  it('clamps out-of-range and broken scores', () => {
    expect(scoreStars(150)).toBe(3);
    expect(scoreStars(-20)).toBe(0);
    expect(scoreStars(Number.NaN)).toBe(0);
  });
});
