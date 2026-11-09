/**
 * Deterministic vector geometry for the three porcelain stamp motifs.
 *
 * The stamps are drawn procedurally: every asset is a list of stroked
 * polylines in a local space normalised to [-1, 1]. There is no background
 * rectangle and no raster image, so a stamp can never contribute a black
 * frame and no third-party licence is involved.
 *
 * Coordinate contract
 * ------------------
 * - Local space: x and y both live in [-1, 1]; the motif is centred on the
 *   origin and always fits inside that box.
 * - Texture space: the painting texture is 2048x2048 and the UV origin is
 *   bottom-left, so `x = u * 2048` and `y = (1 - v) * 2048`.
 * - The footprint of a stamp covers the whole [-1, 1] box, therefore one
 *   local unit equals `placement.size / 2` texture pixels. A stroke of local
 *   width `w` is rasterised with `lineWidth = w * placement.size / 2`.
 *
 * The module is pure: no DOM, no canvas, no React, no randomness and no time
 * dependence. `buildStampGeometry` always returns the same geometry for the
 * same asset id.
 */

import { CUSTOM_STAMP_SIZE, decodeCustomStampId } from './contour';

/** Identifiers of the built-in stamp motifs plus custom imported contour stamps. */
export type StampAssetId = 'lotus' | 'seaside' | 'cloud' | `custom:${string}`;

/** A selectable stamp motif as shown in the tool panel. */
export interface StampAsset {
  id: StampAssetId;
  name: string;
  description: string;
  size: number;
}

/** The three built-in motifs, in display order: 缠枝莲 / 海水江崖 / 云纹. */
export const STAMP_ASSETS: readonly StampAsset[] = [
  {
    id: 'lotus',
    name: '缠枝莲',
    description: '缠枝莲：卷草藤蔓、成对叶片与一朵莲花的连续缠枝纹样。',
    size: 220,
  },
  {
    id: 'seaside',
    name: '海水江崖',
    description: '海水江崖：下层层叠海水波纹与上层江崖山石相组合的纹样。',
    size: 240,
  },
  {
    id: 'cloud',
    name: '云纹',
    description: '云纹：三卷如意祥云头与一条云尾组成的团云纹样。',
    size: 200,
  },
];

/** Allowed relative scale of a stamp footprint. */
export const STAMP_SCALE_RANGE = { min: 0.25, max: 4 } as const;

/** Allowed stamp rotation in radians (a full turn is `2 * PI`). */
export const STAMP_ROTATION_RANGE = { min: -Math.PI, max: Math.PI } as const;

/** A stroked polyline in local stamp space, coordinates normalised to [-1, 1]. */
export interface StampPath {
  points: [number, number][];
  closed: boolean;
  width: number;
}

/** Deterministic geometry for a stamp; no randomness, no time dependence. */
export interface StampGeometry {
  paths: StampPath[];
}

/** Where and how a stamp lands on the 2048 texture. */
export interface StampPlacement {
  x: number;
  y: number;
  size: number;
  rotation: number;
}

type Point = [number, number];

const TAU = Math.PI * 2;

/** Look a motif up by id; unknown ids resolve to `undefined`. */
export function getStampAsset(id: string): StampAsset | undefined {
  const builtin = STAMP_ASSETS.find((asset) => asset.id === id);
  if (builtin) return builtin;
  if (decodeCustomStampId(id)) {
    return {
      id: id as StampAssetId,
      name: '导入图样',
      description: '导入图片提取的青花轮廓纹样。',
      size: CUSTOM_STAMP_SIZE,
    };
  }
  return undefined;
}

/** Build the deterministic geometry of one motif. */
export function buildStampGeometry(id: StampAssetId): StampGeometry {
  if (id === 'lotus') return { paths: lotusPaths() };
  if (id === 'seaside') return { paths: seasidePaths() };
  if (id === 'cloud') return { paths: cloudPaths() };
  return decodeCustomStampId(id) ?? { paths: [] };
}

/**
 * Map a UV hit onto the 2048 painting texture.
 *
 * `scale` is clamped to [0.25, 4] and `rotation` (radians) to [-PI, PI], so a
 * stray slider value can never produce an invisible or absurd stamp. The
 * returned `size` is the footprint in texture pixels: the local [-1, 1] box
 * maps onto that many pixels.
 */
export function stampPlacement(
  u: number,
  v: number,
  asset: StampAsset,
  scale: number,
  rotation: number,
): StampPlacement {
  return {
    x: u * 2048,
    y: (1 - v) * 2048,
    size:
      asset.size * clamp(scale, STAMP_SCALE_RANGE.min, STAMP_SCALE_RANGE.max),
    rotation: clamp(
      rotation,
      STAMP_ROTATION_RANGE.min,
      STAMP_ROTATION_RANGE.max,
    ),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Rotate a local offset around `base` by `angle` radians. */
function rotateAround(base: Point, x: number, y: number, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [base[0] + x * cos - y * sin, base[1] + x * sin + y * cos];
}

/**
 * A closed teardrop (leaf or petal) growing from `base` along `angle`.
 * The outline is the upper curve from base to tip plus the lower curve back;
 * the closing segment links the last point to the base, so the first point is
 * never repeated as the last one.
 */
function teardrop(
  base: Point,
  angle: number,
  length: number,
  halfWidth: number,
  strokeWidth: number,
): StampPath {
  const steps = 10;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const off = halfWidth * Math.sin(Math.PI * s);
    points.push(rotateAround(base, s * length, off, angle));
  }
  for (let i = steps - 1; i >= 1; i--) {
    const s = i / steps;
    const off = -halfWidth * Math.sin(Math.PI * s);
    points.push(rotateAround(base, s * length, off, angle));
  }
  return { points, closed: true, width: strokeWidth };
}

/** A closed regular polygon approximating a small disc. */
function disc(center: Point, radius: number, strokeWidth: number): StampPath {
  const steps = 16;
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * TAU;
    points.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }
  return { points, closed: true, width: strokeWidth };
}

/** An open spiral curling inwards, used for cloud heads and wave curls. */
function spiral(
  center: Point,
  radiusStart: number,
  radiusEnd: number,
  turns: number,
  phase: number,
  strokeWidth: number,
): StampPath {
  const steps = Math.round(turns * 28);
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = phase + t * turns * TAU;
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    points.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }
  return { points, closed: false, width: strokeWidth };
}

/** An open wave line running across the motif. */
function wave(
  baseY: number,
  amplitude: number,
  wavelength: number,
  phase: number,
  strokeWidth: number,
): StampPath {
  const steps = 56;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -0.95 + (1.9 * i) / steps;
    const y = baseY + amplitude * Math.sin((x / wavelength) * TAU + phase);
    points.push([x, y]);
  }
  return { points, closed: false, width: strokeWidth };
}

/** Height of the scrolling vine at a given local x. */
function vineY(x: number): number {
  return 0.32 * Math.sin((Math.PI * x) / 0.88);
}

/** 缠枝莲: a sinusoidal vine, paired leaves and one lotus blossom. */
function lotusPaths(): StampPath[] {
  const paths: StampPath[] = [];
  const vine: Point[] = [];
  const vineSteps = 36;
  for (let i = 0; i <= vineSteps; i++) {
    const x = -0.84 + (1.68 * i) / vineSteps;
    vine.push([x, vineY(x)]);
  }
  paths.push({ points: vine, closed: false, width: 0.07 });

  // Four leaves, alternating on both flanks of the vine: two below the
  // trough and one on each shoulder. They sprout from different points of
  // the vine and curl apart, as in a real 缠枝莲 scroll rather than as a
  // mirrored butterfly.
  const leaves: { x: number; angle: number; length: number }[] = [
    { x: -0.66, angle: 225, length: 0.22 },
    { x: -0.3, angle: 300, length: 0.22 },
    { x: -0.1, angle: 115, length: 0.2 },
    { x: 0.62, angle: 335, length: 0.2 },
  ];
  for (const leaf of leaves) {
    paths.push(
      teardrop(
        [leaf.x, vineY(leaf.x)],
        deg(leaf.angle),
        leaf.length,
        0.085,
        0.05,
      ),
    );
  }

  // The blossom grows out of the crest of the vine, on a short stem.
  const blossom: Point = [0.44, 0.4];
  const petals: { angle: number; length: number; half: number }[] = [
    { angle: 90, length: 0.32, half: 0.13 },
    { angle: 130, length: 0.26, half: 0.11 },
    { angle: 50, length: 0.26, half: 0.11 },
    { angle: 165, length: 0.24, half: 0.1 },
    { angle: 15, length: 0.24, half: 0.1 },
  ];
  for (const petal of petals) {
    paths.push(
      teardrop(blossom, deg(petal.angle), petal.length, petal.half, 0.05),
    );
  }
  paths.push(disc(blossom, 0.07, 0.04));
  paths.push({
    points: [
      [0.44, 0.24],
      [0.44, 0.4],
    ],
    closed: false,
    width: 0.05,
  });
  return paths;
}

/** 海水江崖: layered waves at the bottom, a rocky peak above. */
function seasidePaths(): StampPath[] {
  return [
    wave(-0.78, 0.07, 0.55, 0, 0.05),
    wave(-0.58, 0.06, 0.45, 0.7, 0.05),
    wave(-0.38, 0.05, 0.7, 1.4, 0.05),
    spiral([-0.5, -0.62], 0.16, 0.03, 1.25, 0, 0.045),
    spiral([0.5, -0.62], 0.16, 0.03, 1.25, Math.PI, 0.045),
    {
      points: [
        [-0.6, -0.12],
        [-0.3, 0.18],
        [-0.16, 0.08],
        [0.05, 0.88],
        [0.2, 0.26],
        [0.34, 0.36],
        [0.62, -0.12],
      ],
      closed: true,
      width: 0.055,
    },
    {
      points: [
        [-0.95, -0.12],
        [-0.84, 0.16],
        [-0.74, 0.08],
        [-0.66, -0.12],
      ],
      closed: true,
      width: 0.05,
    },
    {
      points: [
        [0.44, -0.12],
        [0.54, 0.1],
        [0.64, 0.02],
        [0.76, 0.24],
        [0.95, -0.12],
      ],
      closed: true,
      width: 0.05,
    },
    {
      points: [
        [-0.06, 0.08],
        [0, 0.34],
      ],
      closed: false,
      width: 0.04,
    },
    {
      points: [
        [0.14, 0.02],
        [0.22, 0.26],
      ],
      closed: false,
      width: 0.04,
    },
    {
      points: [
        [-0.28, 0],
        [-0.24, 0.14],
      ],
      closed: false,
      width: 0.04,
    },
    {
      points: [
        [-0.85, 0],
        [-0.8, 0.1],
      ],
      closed: false,
      width: 0.04,
    },
    {
      points: [
        [0.7, 0.02],
        [0.76, 0.16],
      ],
      closed: false,
      width: 0.04,
    },
  ];
}

/** 云纹: a three-scroll ruyi cloud head with a trailing cloud tail. */
function cloudPaths(): StampPath[] {
  return [
    spiral([0, 0.14], 0.4, 0.06, 2, -Math.PI / 2, 0.055),
    spiral([-0.66, -0.12], 0.24, 0.04, 1.5, Math.PI, 0.05),
    spiral([0.66, -0.12], 0.24, 0.04, 1.5, 0, 0.05),
    {
      points: [
        [-0.95, -0.2],
        [-0.8, 0.12],
        [-0.5, 0.3],
        [-0.28, 0.2],
        [-0.2, 0.5],
        [0, 0.64],
        [0.2, 0.5],
        [0.28, 0.2],
        [0.5, 0.3],
        [0.8, 0.12],
        [0.95, -0.2],
        [0.62, -0.44],
        [0.28, -0.34],
        [0, -0.5],
        [-0.28, -0.34],
        [-0.62, -0.44],
      ],
      closed: true,
      width: 0.055,
    },
    {
      points: [
        [-0.6, -0.42],
        [-0.52, -0.62],
        [-0.32, -0.73],
        [-0.08, -0.7],
        [0.08, -0.58],
        [0.14, -0.44],
      ],
      closed: false,
      width: 0.05,
    },
  ];
}
