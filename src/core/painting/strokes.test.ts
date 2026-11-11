import { describe, expect, it } from 'vitest';
import { createProfile, sampleProfile } from '../geometry/profile';
import { getStampAsset } from './stamps';
import {
  MASTERPIECE_PRESETS,
  ROTARY_PATTERNS,
  MIN_POINT_DISTANCE,
  SEAM_SPLIT_THRESHOLD,
  SYMMETRY_OPTIONS,
  TEXTURE_SIZE,
  appendStroke,
  azimuthToU,
  buildRingBandPath,
  createMasterpiecePreset,
  createRotaryPattern,
  drawOffsets,
  extendPath,
  mergePath,
  replicatePathBySymmetry,
  replicatePointBySymmetry,
  rotaryRepeatCount,
  shortestAngleDelta,
  splitSegment,
  unwrapTheta,
  wrapU,
} from './strokes';

it('splits both seam directions without drawing across the texture', () => {
  const forward = splitSegment({ u: 0.95, v: 0.4 }, { u: 0.05, v: 0.6 });
  expect(forward).toHaveLength(2);
  expect(forward[0][1].u).toBe(1);
  expect(forward[1][0].u).toBe(0);
  expect(forward[0][1].v).toBeCloseTo(0.5);
  expect(splitSegment({ u: 0.05, v: 0.6 }, { u: 0.95, v: 0.4 })[0][1].u).toBe(
    0,
  );
  expect(splitSegment({ u: 0.2, v: 0.4 }, { u: 0.3, v: 0.5 })).toHaveLength(1);
});
it('new drawing after undo discards redo while retaining all earlier commands', () => {
  const line = { points: [{ u: 0.5, v: 0.5 }], size: 24, color: '#174a94' };
  const initial = Array.from({ length: 25 }, () => line);
  const result = appendStroke(initial, 23, line);
  expect(result).toHaveLength(24);
  expect(initial).toHaveLength(25);
});

describe('stroke constants', () => {
  it('pins the texture size, the merge distance and the seam threshold', () => {
    expect(TEXTURE_SIZE).toBe(2048);
    expect(MIN_POINT_DISTANCE).toBe(0.0025);
    expect(SEAM_SPLIT_THRESHOLD).toBe(0.5);
  });
});

describe('azimuth helpers', () => {
  it('measures the shortest signed turn between two azimuths', () => {
    expect(shortestAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(shortestAngleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    // 3PI/2 is really -PI/2 once the turn is taken the short way.
    expect(shortestAngleDelta(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
    // -PI is reported as +PI so the result stays inside (-PI, PI].
    expect(shortestAngleDelta(0, -Math.PI)).toBeCloseTo(Math.PI);
    expect(shortestAngleDelta(Math.PI, -Math.PI)).toBe(0);
  });

  it('unwraps an azimuth into the branch next to the previous one', () => {
    expect(unwrapTheta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(unwrapTheta(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
    expect(unwrapTheta(3, -3)).toBeCloseTo(3 + 0.2831853071795865);
  });

  it('maps an azimuth onto the seam relative u coordinate', () => {
    expect(azimuthToU(0)).toBe(0);
    expect(azimuthToU(Math.PI)).toBeCloseTo(0.5);
    expect(azimuthToU(-Math.PI / 2)).toBeCloseTo(0.75);
    expect(azimuthToU(Math.PI * 2)).toBe(0);
    expect(azimuthToU(Math.PI, Math.PI)).toBe(0);
  });

  it('wraps any u into [0,1)', () => {
    expect(wrapU(0.25)).toBe(0.25);
    expect(wrapU(1.25)).toBe(0.25);
    expect(wrapU(-0.25)).toBeCloseTo(0.75);
    expect(wrapU(1)).toBe(0);
    expect(wrapU(-0)).toBe(0);
  });
});

describe('seam splitting', () => {
  it('keeps a segment that stays on one side of the seam', () => {
    const a = { u: 0.2, v: 0.4 };
    const b = { u: 0.3, v: 0.5 };
    expect(splitSegment(a, b)).toEqual([[a, b]]);
  });

  it('interpolates v at the seam for both directions', () => {
    const forward = splitSegment({ u: 0.95, v: 0.4 }, { u: 0.05, v: 0.6 });
    expect(forward[1][1]).toEqual({ u: 0.05, v: 0.6 });
    const backward = splitSegment({ u: 0.05, v: 0.6 }, { u: 0.95, v: 0.4 });
    expect(backward[0][0]).toEqual({ u: 0.05, v: 0.6 });
    expect(backward[1][0].u).toBe(1);
    expect(backward[0][1].v).toBeCloseTo(0.5);
  });

  it('never produces NaN for a jump of a whole turn', () => {
    const forward = splitSegment({ u: 0.5, v: 0.4 }, { u: 1.5, v: 0.6 });
    const backward = splitSegment({ u: 0.5, v: 0.4 }, { u: -0.5, v: 0.6 });
    for (const segments of [forward, backward]) {
      expect(segments).toHaveLength(2);
      for (const [from, to] of segments)
        for (const point of [from, to]) {
          expect(Number.isFinite(point.u)).toBe(true);
          expect(Number.isFinite(point.v)).toBe(true);
        }
    }
  });

  it('wraps the second half of a jump back into the texture', () => {
    const segments = splitSegment({ u: 0.5, v: 0.4 }, { u: 1.5, v: 0.6 });
    expect(segments[1][1].u).toBe(0.5);
  });

  it('clamps the interpolated v when the jump overshoots the seam', () => {
    const segments = splitSegment({ u: 0.2, v: 0.3 }, { u: 1.4, v: 0.9 });
    expect(segments[0][1].v).toBeCloseTo(0.3);
    const other = splitSegment({ u: 0.8, v: 0.3 }, { u: -0.6, v: 0.9 });
    expect(other[0][1].v).toBeCloseTo(0.3);
  });
});

describe('stroke list', () => {
  it('keeps the stroke independent from the caller', () => {
    const line = { points: [{ u: 0.5, v: 0.5 }], size: 24, color: '#174a94' };
    const result = appendStroke([], 0, line);
    line.points[0].u = 0.9;
    expect(result[0].points[0].u).toBe(0.5);
  });
});

describe('path helpers', () => {
  it('merges duplicate samples and clamps them into the texture', () => {
    const merged = mergePath([
      { u: -0.1, v: 1.4 },
      { u: 0.2, v: 0.5 },
      { u: 0.2005, v: 0.5 },
      { u: 0.6, v: 0.7 },
    ]);
    expect(merged).toEqual([
      { u: 0, v: 1 },
      { u: 0.2, v: 0.5 },
      { u: 0.6, v: 0.7 },
    ]);
  });

  it('anchors the very first sample', () => {
    expect(extendPath([], { u: 0.4, v: 0.5 })).toEqual([{ u: 0.4, v: 0.5 }]);
  });

  it('unwraps a sample that crosses the seam', () => {
    const path = extendPath([{ u: 0.98, v: 0.5 }], { u: 0.02, v: 0.5 });
    expect(path).toHaveLength(2);
    expect(path[0].u).toBe(0.98);
    expect(path[1].u).toBeCloseTo(1.02);
    expect(path[1].v).toBe(0.5);
  });

  it('keeps a sample that is already continuous', () => {
    const path = extendPath([{ u: 1, v: 0.5 }], { u: 1.02, v: 0.5 });
    expect(path[1].u).toBeCloseTo(1.02);
  });

  it('drops a sample that is too close to the previous one', () => {
    const source = [{ u: 0.5, v: 0.5 }];
    const path = extendPath(source, { u: 0.501, v: 0.5 });
    expect(path).toHaveLength(1);
    expect(source).toHaveLength(1);
  });

  it('clamps the vertical coordinate of a new sample', () => {
    const path = extendPath([{ u: 0.5, v: 0.5 }], { u: 0.6, v: 1.4 });
    expect(path[1].v).toBe(1);
  });
});

describe('draw offsets', () => {
  it('returns the neighbouring texture widths for a path inside the texture', () => {
    expect(
      drawOffsets([
        { u: 0.2, v: 0.5 },
        { u: 0.3, v: 0.5 },
      ]),
    ).toEqual([-2048, 0, 2048]);
  });

  it('keeps the seam part of a continuous path on the canvas', () => {
    expect(
      drawOffsets([
        { u: 0.98, v: 0.5 },
        { u: 1.02, v: 0.5 },
      ]),
    ).toEqual([-2048, 0, 2048]);
  });

  it('supports another texture size', () => {
    expect(drawOffsets([{ u: 0.2, v: 0.5 }], 512)).toEqual([-512, 0, 512]);
  });

  it('returns a single offset for an empty path', () => {
    expect(drawOffsets([])).toEqual([0]);
  });

  it('shifts a path that drifted beyond one texture width', () => {
    expect(
      drawOffsets([
        { u: 2.3, v: 0.5 },
        { u: 2.4, v: 0.5 },
      ]),
    ).toEqual([-4096, -2048, 0, 2048]);
  });
});

describe('symmetry, ring bands and masterpiece presets', () => {
  it('exposes symmetry options and replicates paths around the circumference', () => {
    expect(SYMMETRY_OPTIONS.map((o) => o.count)).toEqual([1, 2, 4, 6, 8]);
    expect(replicatePathBySymmetry([])).toEqual([]);
    const paths = replicatePathBySymmetry(
      [
        { u: 0.9, v: 0.4 },
        { u: 1.05, v: 0.5 },
      ],
      4,
    );
    expect(paths).toHaveLength(4);
    expect(paths[0][0].u).toBeCloseTo(0.9);
    expect(paths[0][1].u - paths[0][0].u).toBeCloseTo(0.15);
    expect(paths[1][0].u).toBeCloseTo(0.15);
    expect(paths[1][1].u - paths[1][0].u).toBeCloseTo(0.15);
  });

  it('replicates single points and builds horizontal ring band paths', () => {
    expect(replicatePointBySymmetry({ u: 0.1, v: 0.5 })).toEqual([
      { u: 0.1, v: 0.5 },
    ]);
    const pts = replicatePointBySymmetry({ u: 0.8, v: 0.5 }, 2);
    expect(pts).toHaveLength(2);
    expect(pts[0].u).toBeCloseTo(0.8);
    expect(pts[1].u).toBeCloseTo(0.3);

    const ring = buildRingBandPath(0.75, 8);
    expect(ring).toHaveLength(9);
    expect(ring[0]).toEqual({ u: 0, v: 0.75 });
    expect(ring[8]).toEqual({ u: 1, v: 0.75 });
  });

  it('builds three distinct museum-inspired compositions from paint actions', () => {
    const expected = [
      ['museum-spear', 'museum-fret', 'museum-lotus', 'museum-lappet'],
      [
        'museum-lappet',
        'museum-pomegranate',
        'museum-peach',
        'museum-citron',
        'museum-lappet',
      ],
      ['museum-horse'],
    ];
    expect(MASTERPIECE_PRESETS.map((preset) => preset.reference)).toEqual([
      'yuhuchun',
      'meiping',
      'yazhbei',
    ]);
    for (const [index, preset] of MASTERPIECE_PRESETS.entries()) {
      const actions = createMasterpiecePreset(
        preset.id,
        0.9,
        createProfile(),
        1,
      );
      expect(actions.length).toBeGreaterThanOrEqual(5);
      const stamps = actions.filter((action) => action.type === 'STAMP');
      expect(stamps.map((action) => action.assetId)).toEqual(expected[index]);
      for (const stamp of stamps) {
        expect(getStampAsset(stamp.assetId)?.svgPaths?.length).toBeGreaterThan(
          0,
        );
        expect(
          getStampAsset(stamp.assetId)?.svgPaths?.some(
            (path) => path.fill !== undefined,
          ),
        ).toBe(true);
        expect(stamp.u).toBeGreaterThanOrEqual(0);
        expect(stamp.u).toBeLessThan(1);
      }
      const rings = actions.filter((action) => action.type === 'BRUSH');
      expect(
        rings.every(
          (ring) => ring.path[0].u === 0 && ring.path.at(-1)?.u === 1,
        ),
      ).toBe(true);
    }
    const horse = createMasterpiecePreset(
      'horse_cup',
      0.9,
      createProfile(),
      1,
    ).find((action) => action.type === 'STAMP');
    expect(horse).toMatchObject({ u: 0.9, repeatCount: 2 });
    expect(horse).not.toHaveProperty('symmetry');
    const spear = createMasterpiecePreset(
      'imperial_lotus',
      0.9,
      createProfile(),
      1,
    ).find((action) => action.type === 'STAMP');
    expect(spear).toMatchObject({ repeatCount: 8 });
  });

  it('compensates the horizontal UV footprint for the height and radius of the vessel', () => {
    for (const [bottom, top, height] of [
      [0.5, 0.5, 0.55],
      [0.5, 0.5, 1.4],
      [0.34, 0.74, 1],
    ]) {
      const profile = createProfile().map((point) => ({
        ...point,
        radius: bottom + (top - bottom) * point.height,
      }));
      const horse = createMasterpiecePreset(
        'horse_cup',
        0,
        profile,
        height,
      ).find((action) => action.type === 'STAMP')!;
      const { u, v } = horse.footprint!;
      const radius = bottom + (top - bottom) * horse.v;
      expect(u / v).toBeCloseTo(
        Math.hypot(2.8 * height, top - bottom) / (2 * Math.PI * radius),
      );
      expect(u).toBeLessThanOrEqual(0.32);
      expect(v).toBeLessThanOrEqual(0.5);
    }
  });

  it('floors motif count to fit the circumference, then tiles a seamless loop', () => {
    const radius = 0.6;
    const size = 0.8;
    const profile = createProfile();
    const actualRadius = sampleProfile(profile).reduce((nearest, point) =>
      Math.abs(point.height - 0.5) < Math.abs(nearest.height - 0.5)
        ? point
        : nearest,
    ).radius;
    const expectedRepeats = Math.floor(
      (2 * Math.PI * actualRadius * 10) / size,
    );
    expect(rotaryRepeatCount(radius, size)).toBe(
      Math.floor((2 * Math.PI * radius * 10) / size),
    );

    const [wave] = createRotaryPattern(
      'linked-wave',
      '#174a94',
      0.25,
      0.5,
      size,
      profile,
    );
    expect(wave.type).toBe('BRUSH');
    if (wave.type === 'BRUSH') {
      expect(wave.path).toHaveLength(expectedRepeats * 32 + 1);
      expect(wave.path[0].u).toBeCloseTo(0.25 - 0.5 / expectedRepeats);
      expect(wave.path[16].u).toBeCloseTo(0.25);
      expect(wave.path.at(-1)?.u).toBeCloseTo(1.25 - 0.5 / expectedRepeats);
      expect(wave.path[0].v).toBe(wave.path.at(-1)?.v);
    }
    const [keyFret] = createRotaryPattern(
      'key-fret',
      '#174a94',
      0.25,
      0.5,
      size,
      profile,
    );
    expect(keyFret.type).toBe('STAMP');
    if (keyFret.type === 'STAMP') expect(keyFret.assetId).toBe('blue-key-fret');
  });

  it('adds a straight ring and scales the filled symmetric leaf footprint', () => {
    expect(ROTARY_PATTERNS.map(({ id }) => id)).toEqual([
      'linked-wave',
      'straight-line',
      'leaf',
      'filled-lotus',
      'key-fret',
    ]);
    const profile = createProfile();
    const line = createRotaryPattern(
      'straight-line',
      '#174a94',
      0.2,
      0.5,
      2,
      profile,
    );
    expect(line).toHaveLength(1);
    expect(line[0].type).toBe('BRUSH');
    if (line[0].type === 'BRUSH')
      expect(line[0].path.every(({ v }) => v === 0.5)).toBe(true);

    const smallLeaf = createRotaryPattern(
      'leaf',
      '#174a94',
      0.2,
      0.5,
      1.5,
      profile,
    );
    const largeLeaf = createRotaryPattern(
      'leaf',
      '#174a94',
      0.2,
      0.5,
      3,
      profile,
    );
    expect(smallLeaf).toHaveLength(1);
    expect(largeLeaf).toHaveLength(1);
    expect(largeLeaf[0].type).toBe('STAMP');
    expect(smallLeaf[0].type).toBe('STAMP');
    if (largeLeaf[0].type === 'STAMP' && smallLeaf[0].type === 'STAMP') {
      expect(smallLeaf[0].assetId).toBe('rotary-leaf');
      expect(smallLeaf[0].footprint?.u).toBeGreaterThan(
        1 / smallLeaf[0].repeatCount!,
      );
      expect(smallLeaf[0].repeatCount).toBeGreaterThan(
        largeLeaf[0].repeatCount!,
      );
      expect(largeLeaf[0].footprint?.v).toBeGreaterThan(
        smallLeaf[0].footprint!.v,
      );
    }

    const lotus = createRotaryPattern(
      'filled-lotus',
      '#174a94',
      0.2,
      0.5,
      2,
      profile,
    );
    expect(lotus[0].type).toBe('STAMP');
    if (lotus[0].type === 'STAMP')
      expect(lotus[0].assetId).toBe('filled-lotus');
  });

  it('rejects unknown rotary motifs', () => {
    expect(() =>
      createRotaryPattern(
        'unknown' as never,
        '#174a94',
        0,
        0.5,
        1,
        createProfile(),
      ),
    ).toThrow('Unknown rotary pattern');
  });
});
