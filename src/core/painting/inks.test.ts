import { describe, expect, it } from 'vitest';
import { INKS, inkOpacityFor } from './inks';

describe('cobalt ink palette', () => {
  it('exposes three water-splitting tones from darkest to lightest', () => {
    expect(INKS.map((ink) => ink.label)).toEqual(['浓青', '中青', '淡青']);
    const opacities = INKS.map((ink) => ink.opacity);
    expect(opacities).toEqual([...opacities].sort((a, b) => b - a));
    expect(opacities[0]).toBe(1);
  });

  it('maps every palette colour to its opacity and defaults unknown inks to solid', () => {
    for (const ink of INKS) {
      expect(inkOpacityFor(ink.value)).toBe(ink.opacity);
    }
    expect(inkOpacityFor('#123456')).toBe(1);
  });
});
