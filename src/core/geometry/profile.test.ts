import { describe, expect, it } from 'vitest';
import { createProfile, sampleProfile } from './profile';
describe('runnable shaping baseline', () => {
  it('samples finite, monotonic radii with preserved endpoints', () => {
    const points = createProfile();
    const sampled = sampleProfile(points);
    expect(points).toHaveLength(8);
    expect(sampled).toHaveLength(65);
    expect(sampled[0]).toEqual({ radius: points[0].radius, height: 0 });
    expect(sampled[64].height).toBe(1);
    expect(
      sampled.every(
        (p, i) =>
          Number.isFinite(p.radius) &&
          p.radius >= 0.08 &&
          (!i || p.height > sampled[i - 1].height),
      ),
    ).toBe(true);
  });
  it('rejects malformed profiles rather than rendering broken geometry', () => {
    expect(() => sampleProfile([])).toThrow();
    expect(() =>
      sampleProfile(createProfile().map((p) => ({ ...p, radius: NaN }))),
    ).toThrow();
  });
});
it('rejects profiles that do not cover the whole normalized height', () => {
  const bottom = createProfile();
  bottom[0].height = 0.01;
  expect(() => sampleProfile(bottom)).toThrow('endpoints');
  const top = createProfile();
  top[7].height = 0.99;
  expect(() => sampleProfile(top)).toThrow('endpoints');
});
