import { describe, expect, it } from 'vitest';
import {
  BISQUE_RECIPE,
  FIRING_DURATION_MS,
  WHITE_GLAZE_RECIPE,
  firingStage,
  glazeProgress,
  interpolateRecipe,
  recipeAt,
} from './glaze';

describe('glazeProgress', () => {
  it('maps the firing window onto 0..1 and clamps out-of-range input', () => {
    expect(glazeProgress(0)).toBe(0);
    expect(glazeProgress(FIRING_DURATION_MS)).toBe(1);
    expect(glazeProgress(-500)).toBe(0);
    expect(glazeProgress(FIRING_DURATION_MS * 4)).toBe(1);
    expect(glazeProgress(Number.NaN)).toBe(0);
    expect(glazeProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(glazeProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('eases the curve instead of running linearly', () => {
    const quarter = glazeProgress(FIRING_DURATION_MS * 0.25);
    expect(quarter).toBeLessThan(0.25);
    expect(quarter).toBeGreaterThan(0);
    expect(glazeProgress(FIRING_DURATION_MS * 0.5)).toBeCloseTo(0.5, 6);
    // The kiln curve is symmetric around the midpoint.
    expect(glazeProgress(FIRING_DURATION_MS * 0.75)).toBeCloseTo(
      1 - quarter,
      6,
    );
  });

  it('never decreases while the kiln heats up', () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= FIRING_DURATION_MS; elapsed += 10) {
      const value = glazeProgress(elapsed);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('accepts a custom duration and falls back for invalid ones', () => {
    expect(glazeProgress(1000, 2000)).toBeCloseTo(0.5, 6);
    expect(glazeProgress(2000, 2000)).toBe(1);
    expect(glazeProgress(0, 0)).toBe(0);
    expect(glazeProgress(FIRING_DURATION_MS, 0)).toBe(1);
    expect(glazeProgress(FIRING_DURATION_MS, Number.NaN)).toBe(1);
    expect(glazeProgress(FIRING_DURATION_MS, Number.POSITIVE_INFINITY)).toBe(1);
    expect(glazeProgress(FIRING_DURATION_MS, -10)).toBe(1);
  });
});

describe('firingStage', () => {
  it('covers bisque → rising → glazing → complete', () => {
    expect(firingStage(0)).toBe('bisque');
    expect(firingStage(0.2)).toBe('rising');
    expect(firingStage(0.7)).toBe('glazing');
    expect(firingStage(1)).toBe('complete');
  });

  it('clamps and tolerates invalid progress', () => {
    expect(firingStage(-1)).toBe('bisque');
    expect(firingStage(5)).toBe('complete');
    expect(firingStage(Number.NaN)).toBe('bisque');
  });
});

describe('interpolateRecipe', () => {
  it('returns the exact endpoint recipes', () => {
    expect(interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 0)).toEqual(
      BISQUE_RECIPE,
    );
    expect(interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 1)).toEqual(
      WHITE_GLAZE_RECIPE,
    );
  });

  it('blends every numeric channel in the middle', () => {
    const middle = interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 0.5);
    expect(middle.name).toBe(WHITE_GLAZE_RECIPE.name);
    expect(middle.roughness).toBeCloseTo(0.5, 6);
    expect(middle.metalness).toBeCloseTo(0.025, 6);
    expect(middle.clearcoat).toBeCloseTo(0.5, 6);
    expect(middle.clearcoatRoughness).toBeCloseTo(0.05, 6);
    expect(middle.sheen).toBeCloseTo(0.125, 6);
    // sRGB mix of #d5c8b6 and #ffffff.
    expect(middle.color).toBe('#eae4db');
    expect(middle.sheenColor).toBe('#f4eada');
  });

  it('keeps the source name on the first half', () => {
    expect(interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 0.2).name).toBe(
      BISQUE_RECIPE.name,
    );
  });

  it('clamps the blend factor', () => {
    expect(interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, -3)).toEqual(
      BISQUE_RECIPE,
    );
    expect(interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 9)).toEqual(
      WHITE_GLAZE_RECIPE,
    );
    expect(
      interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, Number.NaN),
    ).toEqual(BISQUE_RECIPE);
  });

  it('falls back to a solid colour when a hex value cannot be parsed', () => {
    const broken = { ...BISQUE_RECIPE, color: 'not-a-colour' };
    const alsoBroken = { ...WHITE_GLAZE_RECIPE, color: 'zzz' };
    // An unparsable source colour is kept as-is for the whole blend.
    expect(interpolateRecipe(broken, alsoBroken, 0.25).color).toBe(
      'not-a-colour',
    );
    expect(interpolateRecipe(broken, alsoBroken, 0.75).color).toBe(
      'not-a-colour',
    );
    expect(interpolateRecipe(broken, WHITE_GLAZE_RECIPE, 0.5).color).toBe(
      'not-a-colour',
    );
    // An unparsable target colour is kept as-is as well.
    expect(interpolateRecipe(BISQUE_RECIPE, alsoBroken, 0.5).color).toBe('zzz');
  });

  it('understands three digit hex colours', () => {
    const short = { ...BISQUE_RECIPE, color: '#abc' };
    const dark = { ...WHITE_GLAZE_RECIPE, color: '#000000' };
    expect(interpolateRecipe(short, dark, 0.5).color).toBe('#555e66');
  });
});

describe('recipeAt', () => {
  it('walks from bisque to white glaze', () => {
    expect(recipeAt(0)).toEqual(BISQUE_RECIPE);
    expect(recipeAt(1)).toEqual(WHITE_GLAZE_RECIPE);
    expect(recipeAt(0.5)).toEqual(
      interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, 0.5),
    );
  });

  it('keeps the documented bisque and glaze values', () => {
    expect(BISQUE_RECIPE.roughness).toBe(0.85);
    expect(BISQUE_RECIPE.metalness).toBe(0);
    expect(BISQUE_RECIPE.clearcoat).toBe(0);
    expect(WHITE_GLAZE_RECIPE.roughness).toBe(0.15);
    expect(WHITE_GLAZE_RECIPE.metalness).toBe(0.05);
    expect(WHITE_GLAZE_RECIPE.clearcoat).toBe(1);
    expect(WHITE_GLAZE_RECIPE.clearcoatRoughness).toBe(0.05);
  });
});
