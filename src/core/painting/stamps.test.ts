import { describe, expect, it } from 'vitest';
import {
  buildStampGeometry,
  getStampAsset,
  getStampSvgPaths,
  STAMP_ASSETS,
  STAMP_ROTATION_RANGE,
  STAMP_SCALE_RANGE,
  stampPlacement,
  type StampAssetId,
} from './stamps';

const IDS: StampAssetId[] = ['lotus', 'seaside', 'cloud'];

describe('stamp asset catalogue', () => {
  it('lists the six painted motifs followed by the three vector motifs', () => {
    expect(STAMP_ASSETS.map((asset) => asset.id)).toEqual([
      'lotus-scroll-wash',
      'sea-cliffs-wash',
      'ruyi-cloud-wash',
      'fish-and-grasses-wash',
      'pomegranate-wash',
      'plum-branch-wash',
      'rotary-leaf',
      'filled-lotus',
      'blue-key-fret',
    ]);
    expect(STAMP_ASSETS.map((asset) => asset.name)).toEqual([
      '缠枝莲',
      '海水江崖',
      '云纹',
      '游鱼水藻',
      '折枝石榴',
      '折枝梅',
      '青叶填色',
      '团莲填色',
      '蓝地回纹',
    ]);
    for (const asset of STAMP_ASSETS) {
      expect(asset.size).toBeGreaterThan(0);
      expect(asset.description.length).toBeGreaterThan(0);
      expect(getStampAsset(asset.id)).toBe(asset);
    }
    expect(STAMP_ASSETS.slice(0, 6).every((asset) => asset.maskUrl)).toBe(true);
    expect(STAMP_ASSETS.slice(6).every((asset) => asset.svgPaths?.length)).toBe(
      true,
    );
  });

  it('provides a filled, axially symmetric leaf with porcelain cutouts', () => {
    const leaf = getStampAsset('rotary-leaf');
    expect(leaf).toMatchObject({
      id: 'rotary-leaf',
      name: '青叶填色',
      size: 250,
    });
    expect(leaf?.svgPaths).toHaveLength(1);
    expect(leaf?.svgPaths?.[0].fill).toBeGreaterThan(0.9);
    expect(leaf?.svgPaths?.[0].d.match(/M/g)).toHaveLength(6);
    expect(getStampSvgPaths('rotary-leaf')).toBe(leaf?.svgPaths);
    for (const id of ['filled-lotus', 'blue-key-fret']) {
      const motif = getStampAsset(id);
      expect(motif?.svgPaths?.some((path) => path.fill !== undefined)).toBe(
        true,
      );
    }
  });

  it('can still replay all seven previous vector motifs by their saved IDs', () => {
    for (const id of [
      'lotus-scroll',
      'sea-cliffs',
      'ruyi-cloud',
      'fish-and-grasses',
      'pomegranate',
      'plum-branch',
      'key-fret',
    ] as const) {
      expect(getStampAsset(id)?.maskUrl).toBeUndefined();
      expect(getStampSvgPaths(id)).toBe(getStampAsset(id)?.svgPaths);
      expect(getStampSvgPaths(id).some((path) => path.fill !== undefined)).toBe(
        true,
      );
    }
  });

  it('connects the filled key fret across motif and rotary repeat edges', () => {
    const fret = getStampAsset('blue-key-fret');
    expect(fret?.svgPaths?.[0]).toMatchObject({
      d: 'M0 27 H100 V33 H0 Z M0 67 H100 V73 H0 Z',
    });
    expect(fret?.svgPaths?.[1]).toMatchObject({
      d: 'M0 39 H33 V61 H25 V45 H12 V53 H22 V56 H5 V42 H0 Z M33 39 H66 V61 H58 V45 H45 V53 H55 V56 H38 V42 H33 Z M66 39 H100 V61 H92 V45 H79 V53 H89 V56 H72 V42 H66 Z',
    });
  });

  it('keeps the remaining vector cursor previews near the regular stamp scale', () => {
    expect(STAMP_ASSETS.slice(-3).map(({ size }) => size)).toEqual([
      250, 245, 250,
    ]);
  });

  it('resolves known ids and ignores unknown ones', () => {
    expect(getStampAsset('lotus')?.size).toBe(220);
    expect(getStampAsset('seaside')?.size).toBe(240);
    expect(getStampAsset('cloud')?.size).toBe(200);
    expect(getStampAsset('nope')).toBeUndefined();
    expect(getStampAsset('')).toBeUndefined();
    const customId = 'custom:0,40:-300,-200;300,200' as const;
    expect(getStampAsset(customId)?.name).toBe('导入图样');
    expect(buildStampGeometry(customId).paths).toHaveLength(1);
    expect(
      buildStampGeometry('custom:invalid' as StampAssetId).paths,
    ).toHaveLength(0);
  });

  it('projects imported and legacy outlines into the shared SVG coordinate space', () => {
    const customId = 'custom:0,40:-300,-200;300,200' as const;
    expect(getStampSvgPaths(customId)).toEqual([
      { d: 'M35 60 L65 40', width: 2 },
    ]);
    expect(
      getStampSvgPaths(customId, [
        {
          points: [
            [-1, -1],
            [0, 1],
            [1, -1],
          ],
          closed: true,
          width: 0.04,
        },
      ]),
    ).toEqual([{ d: 'M0 100 L50 0 L100 100 Z', width: 2 }]);
    expect(getStampSvgPaths('lotus')).toHaveLength(12);
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
