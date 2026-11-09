import { describe, expect, it } from 'vitest';
import {
  CUSTOM_STAMP_PREFIX,
  decodeCustomStampId,
  encodeCustomStampId,
  extractImageContours,
  simplifyPixelChain,
} from './contour';

function createBlankRgba(
  width: number,
  height: number,
  fill = 255,
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = fill;
    buf[i * 4 + 1] = fill;
    buf[i * 4 + 2] = fill;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function setPixel(
  buf: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  gray: number,
  alpha = 255,
) {
  const idx = (y * width + x) * 4;
  buf[idx] = gray;
  buf[idx + 1] = gray;
  buf[idx + 2] = gray;
  buf[idx + 3] = alpha;
}

describe('simplifyPixelChain', () => {
  it('returns short chains unchanged and simplifies collinear or curved chains', () => {
    expect(simplifyPixelChain([[1, 2]])).toEqual([[1, 2]]);
    expect(
      simplifyPixelChain([
        [0, 0],
        [5, 0],
      ]),
    ).toEqual([
      [0, 0],
      [5, 0],
    ]);
    // Collinear chain collapses to endpoints
    expect(
      simplifyPixelChain([
        [0, 0],
        [2, 0],
        [4, 0],
      ]),
    ).toEqual([
      [0, 0],
      [4, 0],
    ]);
    // Sharp corner is preserved
    expect(
      simplifyPixelChain([
        [0, 0],
        [4, 5],
        [8, 0],
      ]),
    ).toEqual([
      [0, 0],
      [4, 5],
      [8, 0],
    ]);
    // Identical start and end point exercises zero-length segment distance
    expect(
      simplifyPixelChain([
        [3, 3],
        [6, 7],
        [3, 3],
      ]),
    ).toEqual([
      [3, 3],
      [6, 7],
      [3, 3],
    ]);
  });
});

describe('extractImageContours', () => {
  it('returns empty array for invalid dimensions or uniform images', () => {
    expect(extractImageContours([], 2, 2)).toEqual([]);
    expect(extractImageContours(new Uint8ClampedArray(10), 4, 4)).toEqual([]);
    const blank = createBlankRgba(12, 12, 255);
    expect(extractImageContours(blank, 12, 12)).toEqual([]);

    // A 4x3 vertical step image produces a single-pixel NMS ridge (chain.length = 1 < minChain)
    const tinyStep = createBlankRgba(4, 3, 255);
    for (let y = 0; y < 3; y++) {
      setPixel(tinyStep, 4, 0, y, 0);
      setPixel(tinyStep, 4, 1, y, 0);
    }
    expect(extractImageContours(tinyStep, 4, 3)).toEqual([]);
  });

  it('extracts both horizontal and vertical contour edges from a filled rectangle and isolated dot', () => {
    const w = 24;
    const h = 24;
    const rgba = createBlankRgba(w, h, 255);
    // Solid dark square in the center produces a closed contour loop
    for (let y = 6; y <= 16; y++) {
      for (let x = 6; x <= 16; x++) {
        setPixel(rgba, w, x, y, 0);
      }
    }
    // Single isolated dark pixel at (2, 2) produces a short speck that gets filtered
    setPixel(rgba, w, 2, 2, 0);

    const mediumPaths = extractImageContours(rgba, w, h);
    expect(mediumPaths.length).toBeGreaterThan(0);
    for (const path of mediumPaths) {
      expect(path.points.length).toBeGreaterThanOrEqual(2);
      expect(path.width).toBe(0.04);
      for (const [x, y] of path.points) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }

    const boldPaths = extractImageContours(rgba, w, h, { detail: 'bold' });
    expect(boldPaths.length).toBeGreaterThan(0);
    expect(boldPaths[0].width).toBe(0.048);

    const finePaths = extractImageContours(rgba, w, h, { detail: 'fine' });
    expect(finePaths.length).toBeGreaterThan(0);
    expect(finePaths[0].width).toBe(0.032);
  });

  it('supports inverted dark-background images', () => {
    const w = 20;
    const h = 20;
    const darkBg = createBlankRgba(w, h, 0);
    // Bright horizontal bar on a dark background
    for (let x = 4; x <= 15; x++) {
      setPixel(darkBg, w, x, 10, 255);
      setPixel(darkBg, w, x, 11, 255);
    }
    const paths = extractImageContours(darkBg, w, h, { invert: true });
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('encodeCustomStampId and decodeCustomStampId', () => {
  it('round-trips valid contour paths and ignores malformed inputs', () => {
    const encoded = encodeCustomStampId([
      {
        points: [
          [-0.5, -0.25],
          [0, 0.4],
          [0.5, -0.25],
        ],
        closed: true,
        width: 0.04,
      },
      {
        points: [
          [-0.2, 0.1],
          [0.3, -0.1],
        ],
        closed: false,
        width: 0.032,
      },
      {
        points: [[0, 0]],
        closed: false,
        width: 0.04,
      },
    ]);
    expect(encoded.startsWith(CUSTOM_STAMP_PREFIX)).toBe(true);
    const decoded = decodeCustomStampId(encoded);
    expect(decoded).toEqual({
      paths: [
        {
          points: [
            [-0.5, -0.25],
            [0, 0.4],
            [0.5, -0.25],
          ],
          closed: true,
          width: 0.04,
        },
        {
          points: [
            [-0.2, 0.1],
            [0.3, -0.1],
          ],
          closed: false,
          width: 0.032,
        },
      ],
    });

    expect(decodeCustomStampId('lotus')).toBeUndefined();
    expect(decodeCustomStampId('custom:')).toBeUndefined();
    expect(
      decodeCustomStampId(
        'custom:badsegment|0,40:100|0,-5:10,10;20,20|0,40,1:10,10;20,20|0,40:bad;NaN,10',
      ),
    ).toBeUndefined();
  });
});
