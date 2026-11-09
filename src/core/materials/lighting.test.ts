import { describe, expect, it } from 'vitest';
import {
  BISQUE_LIGHT_RIG,
  CELADON_LIGHT_RIG,
  STUDIO_LIGHT_RIG,
  WARM_LIGHT_RIG,
  exhibitionRigFor,
  rigAt,
  type LightingPresetId,
} from './lighting';

describe('light rigs', () => {
  it('describes a complete rig with a highlight-friendly key light', () => {
    expect(STUDIO_LIGHT_RIG.key.intensity).toBeGreaterThan(
      BISQUE_LIGHT_RIG.key.intensity,
    );
    expect(STUDIO_LIGHT_RIG.key.position).toHaveLength(3);
    expect(STUDIO_LIGHT_RIG.rim.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(STUDIO_LIGHT_RIG.fill.intensity).toBeLessThan(
      STUDIO_LIGHT_RIG.key.intensity,
    );
    expect(STUDIO_LIGHT_RIG.ambient.sky).toMatch(/^#[0-9a-f]{6}$/);
    expect(STUDIO_LIGHT_RIG.ambient.ground).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses a flatter rig while the piece is still bisque', () => {
    expect(BISQUE_LIGHT_RIG.ambient.intensity).toBeGreaterThan(
      STUDIO_LIGHT_RIG.ambient.intensity,
    );
    expect(BISQUE_LIGHT_RIG.rim.intensity).toBeLessThan(
      STUDIO_LIGHT_RIG.rim.intensity,
    );
    expect(BISQUE_LIGHT_RIG.fill.intensity).toBeGreaterThan(
      STUDIO_LIGHT_RIG.fill.intensity,
    );
  });

  it('keeps the rim light cool so the silhouette reads against the backdrop', () => {
    const rim = STUDIO_LIGHT_RIG.rim.color;
    const red = parseInt(rim.slice(1, 3), 16);
    const blue = parseInt(rim.slice(5, 7), 16);
    expect(blue).toBeGreaterThan(red);
  });

  it('resolves exhibition light presets and falls back to studio', () => {
    expect(exhibitionRigFor()).toBe(STUDIO_LIGHT_RIG);
    expect(exhibitionRigFor('studio')).toBe(STUDIO_LIGHT_RIG);
    expect(exhibitionRigFor('warm')).toBe(WARM_LIGHT_RIG);
    expect(exhibitionRigFor('celadon')).toBe(CELADON_LIGHT_RIG);
    expect(exhibitionRigFor('unknown' as LightingPresetId)).toBe(
      STUDIO_LIGHT_RIG,
    );
  });
});

describe('rigAt', () => {
  it('returns the exact endpoint rigs', () => {
    expect(rigAt(0)).toEqual(BISQUE_LIGHT_RIG);
    expect(rigAt(1)).toEqual(STUDIO_LIGHT_RIG);
  });

  it('blends intensity and position in the middle of the firing', () => {
    const middle = rigAt(0.5);
    expect(middle.key.intensity).toBeCloseTo(2.85, 6);
    expect(middle.rim.intensity).toBeCloseTo(1.65, 6);
    expect(middle.fill.intensity).toBeCloseTo(1.05, 6);
    expect(middle.ambient.intensity).toBeCloseTo(1.875, 6);
    expect(middle.key.position).toEqual([3, 5, 4]);
    expect(middle.fill.position).toEqual([-2.6, 1.8, 3.2]);
  });

  it('blends the ambient colours towards the studio rig', () => {
    const middle = rigAt(0.5);
    expect(middle.ambient.sky).toMatch(/^#[0-9a-f]{6}$/);
    expect(middle.ambient.ground).toMatch(/^#[0-9a-f]{6}$/);
    expect(middle.ambient.sky).not.toBe(BISQUE_LIGHT_RIG.ambient.sky);
    expect(middle.ambient.sky).not.toBe(STUDIO_LIGHT_RIG.ambient.sky);
    expect(middle.key.color).not.toBe(BISQUE_LIGHT_RIG.key.color);
    expect(middle.key.color).not.toBe(STUDIO_LIGHT_RIG.key.color);
  });

  it('clamps out-of-range progress and tolerates invalid values', () => {
    expect(rigAt(-3)).toEqual(BISQUE_LIGHT_RIG);
    expect(rigAt(7)).toEqual(STUDIO_LIGHT_RIG);
    expect(rigAt(Number.NaN)).toEqual(BISQUE_LIGHT_RIG);
  });

  it('keeps every channel inside the valid colour range', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const rig = rigAt(progress);
      for (const color of [
        rig.ambient.sky,
        rig.ambient.ground,
        rig.key.color,
        rig.rim.color,
        rig.fill.color,
      ]) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        for (let i = 0; i < 3; i++) {
          const value = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
