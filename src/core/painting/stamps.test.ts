import { describe, expect, it } from 'vitest';
import {
  buildStampGeometry,
  getStampAsset,
  STAMP_ASSETS,
  STAMP_ROTATION_RANGE,
  STAMP_SCALE_RANGE,
  stampPlacement,
  type StampAssetId,
} from './stamps';

const IDS: StampAssetId[] = ['lotus', 'seaside', 'cloud'];

describe('stamp asset catalogue', () => {
  it('lists exactly three motifs in display order', () => {
    expect(STAMP_ASSETS).toHaveLength(3);
    expect(STAMP_ASSETS.map((asset) => asset.id)).toEqual([
      'lotus',
      'seaside',
      'cloud',
    ]);
    expect(STAMP_ASSETS.map((asset) => asset.name)).toEqual([
      '缠枝莲',
      '海水江崖',
      '云纹',
    ]);
    for (const asset of STAMP_ASSETS) {
      expect(asset.size).toBeGreaterThan(0);
      expect(asset.description.length).toBeGreaterThan(0);
    }
  });

  it('resolves known ids and ignores unknown ones', () => {
    expect(getStampAsset('lotus')).toBe(STAMP_ASSETS[0]);
    expect(getStampAsset('seaside')).toBe(STAMP_ASSETS[1]);
    expect(getStampAsset('cloud')).toBe(STAMP_ASSETS[2]);
    expect(getStampAsset('nope')).toBeUndefined();
    expect(getStampAsset('')).toBeUndefined();
  });
});

describe('stamp geometry', () => {
  it('is deterministic for every motif', () => {
    for (const id of IDS) {
      expect(buildStampGeometry(id)).toEqual(buildStampGeometry(id));
    }
  });

  it('keeps every stroke inside the normalised [-1, 1] box', () => {
    for (const id of IDS) {
      const { paths } = buildStampGeometry(id);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.points.length).toBeGreaterThanOrEqual(2);
        expect(path.width).toBeGreaterThan(0);
        for (const [x, y] of path.points) {
          expect(x).toBeGreaterThanOrEqual(-1);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(-1);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('never repeats the first point of a closed path', () => {
    for (const id of IDS) {
      for (const path of buildStampGeometry(id).paths) {
        if (!path.closed) continue;
        const first = path.points[0];
        const last = path.points[path.points.length - 1];
        expect(last).not.toEqual(first);
      }
    }
  });

  it('describes the three motifs with strokes only, so no frame is drawn', () => {
    const lotus = buildStampGeometry('lotus').paths;
    const seaside = buildStampGeometry('seaside').paths;
    const cloud = buildStampGeometry('cloud').paths;
    // A stem, four leaves, a blossom and the scrolling vine.
    expect(lotus.length).toBe(12);
    // Three wave lines, two curls, three rock masses and five texture strokes.
    expect(seaside.length).toBe(13);
    // Three cloud scrolls, the cloud head outline and one tail.
    expect(cloud.length).toBe(5);
    for (const paths of [lotus, seaside, cloud]) {
      for (const path of paths) {
        expect(path.width).toBeGreaterThan(0);
      }
    }
  });
});

describe('stamp placement', () => {
  const asset = STAMP_ASSETS[0];

  it('maps UV onto the 2048 texture with a bottom-left origin', () => {
    expect(stampPlacement(0, 0, asset, 1, 0)).toEqual({
      x: 0,
      y: 2048,
      size: asset.size,
      rotation: 0,
    });
    expect(stampPlacement(0.5, 0.5, asset, 1, 0)).toEqual({
      x: 1024,
      y: 1024,
      size: asset.size,
      rotation: 0,
    });
    expect(stampPlacement(1, 1, asset, 1, 0)).toEqual({
      x: 2048,
      y: 0,
      size: asset.size,
      rotation: 0,
    });
  });

  it('scales the footprint and keeps the rotation in radians', () => {
    expect(stampPlacement(0.5, 0.5, asset, 2, Math.PI / 4)).toEqual({
      x: 1024,
      y: 1024,
      size: asset.size * 2,
      rotation: Math.PI / 4,
    });
  });

  it('clamps the scale into the documented range', () => {
    expect(stampPlacement(0, 0, asset, 0.01, 0).size).toBe(
      asset.size * STAMP_SCALE_RANGE.min,
    );
    expect(stampPlacement(0, 0, asset, 99, 0).size).toBe(
      asset.size * STAMP_SCALE_RANGE.max,
    );
  });

  it('clamps the rotation into the documented range', () => {
    expect(stampPlacement(0, 0, asset, 1, -99).rotation).toBe(
      STAMP_ROTATION_RANGE.min,
    );
    expect(stampPlacement(0, 0, asset, 1, 99).rotation).toBe(
      STAMP_ROTATION_RANGE.max,
    );
  });
});
