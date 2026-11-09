import type { StampGeometry, StampPath } from './stamps';

/** Prefix used to embed extracted vector contour paths inside a stamp assetId. */
export const CUSTOM_STAMP_PREFIX = 'custom:';

/** Footprint size (in 2048-texture pixels at scale = 1) for an imported contour stamp. */
export const CUSTOM_STAMP_SIZE = 320;

export type ContourDetailLevel = 'bold' | 'medium' | 'fine';

export interface ContourOptions {
  /** Controls how many subtle internal edges are preserved alongside the main outline. */
  detail?: ContourDetailLevel;
  /** Set true when the subject is light on a dark background. */
  invert?: boolean;
}

const NEIGHBORS_8: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Perpendicular distance from point `p` to the line segment `a -> b`.
 */
function pointToSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(
    1,
    Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer-Douglas-Peucker polyline simplification in pixel space.
 */
export function simplifyPixelChain(
  points: [number, number][],
  epsilon = 0.65,
): [number, number][] {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let splitIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = pointToSegmentDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      splitIndex = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplifyPixelChain(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyPixelChain(points.slice(splitIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * Extracts clean vector contour paths (`StampPath[]` in `[-1, 1]`) from an
 * RGBA pixel buffer so an imported image can be imprinted onto the porcelain
 * vessel as a blue-and-white cobalt line motif.
 */
export function extractImageContours(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: ContourOptions = {},
): StampPath[] {
  if (width < 3 || height < 3 || rgba.length < width * height * 4) {
    return [];
  }
  const detail: ContourDetailLevel = options.detail ?? 'medium';
  const invert = Boolean(options.invert);
  const total = width * height;

  // 1. Convert RGBA to darkness [0, 255], compositing alpha over porcelain white.
  const dark = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const base = i * 4;
    const r = rgba[base];
    const g = rgba[base + 1];
    const b = rgba[base + 2];
    const a = rgba[base + 3] / 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (1 - a);
    dark[i] = invert ? lum : 255 - lum;
  }

  // 2. 3×3 Gaussian smoothing ([1, 2, 1; 2, 4, 2; 1, 2, 1] / 16)
  const smooth = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(width - 1, x + 1);
      smooth[y * width + x] =
        (dark[y0 * width + x0] +
          2 * dark[y0 * width + x] +
          dark[y0 * width + x2] +
          2 * dark[y * width + x0] +
          4 * dark[y * width + x] +
          2 * dark[y * width + x2] +
          dark[y2 * width + x0] +
          2 * dark[y2 * width + x] +
          dark[y2 * width + x2]) /
        16;
    }
  }

  // 3. Sobel edge gradient & Non-Maximum Suppression
  const mag = new Float32Array(total);
  const horizDom = new Uint8Array(total);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const tl = smooth[(y - 1) * width + (x - 1)];
      const tc = smooth[(y - 1) * width + x];
      const tr = smooth[(y - 1) * width + (x + 1)];
      const ml = smooth[y * width + (x - 1)];
      const mr = smooth[y * width + (x + 1)];
      const bl = smooth[(y + 1) * width + (x - 1)];
      const bc = smooth[(y + 1) * width + x];
      const br = smooth[(y + 1) * width + (x + 1)];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const m = Math.hypot(gx, gy);
      mag[idx] = m;
      horizDom[idx] = Math.abs(gx) >= Math.abs(gy) ? 1 : 0;
      if (m > maxMag) maxMag = m;
    }
  }

  if (maxMag < 24) return [];

  const ratio = detail === 'bold' ? 0.38 : detail === 'fine' ? 0.17 : 0.26;
  const cutoff = Math.max(24, maxMag * ratio);
  const edge = new Uint8Array(total);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const m = mag[idx];
      if (m < cutoff) continue;
      if (horizDom[idx] === 1) {
        if (m >= mag[idx - 1] && m >= mag[idx + 1]) edge[idx] = 1;
      } else if (m >= mag[idx - width] && m >= mag[idx + width]) {
        edge[idx] = 1;
      }
    }
  }

  // 4. Trace 8-connected contour chains and simplify into normalised StampPaths
  const minChain = detail === 'fine' ? 2 : 3;
  const strokeWidth =
    detail === 'bold' ? 0.048 : detail === 'fine' ? 0.032 : 0.04;
  const halfSpan = Math.max(width, height) / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const paths: StampPath[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const startIdx = y * width + x;
      if (edge[startIdx] === 0) continue;
      edge[startIdx] = 0;
      const chain: [number, number][] = [[x, y]];
      let cx = x;
      let cy = y;
      let walking = true;
      while (walking) {
        walking = false;
        for (const [dx, dy] of NEIGHBORS_8) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nIdx = ny * width + nx;
          if (edge[nIdx] === 1) {
            edge[nIdx] = 0;
            chain.push([nx, ny]);
            cx = nx;
            cy = ny;
            walking = true;
            break;
          }
        }
      }
      if (chain.length < minChain) continue;
      const firstPx = chain[0];
      const lastPx = chain[chain.length - 1];
      const closed =
        chain.length >= 6 &&
        Math.hypot(firstPx[0] - lastPx[0], firstPx[1] - lastPx[1]) <= 1.5;
      const simplified = simplifyPixelChain(chain, 0.65);
      const normPoints: [number, number][] = simplified.map(([px, py]) => [
        round3(clampUnit(((px - centerX) / halfSpan) * 0.9)),
        round3(clampUnit(((centerY - py) / halfSpan) * 0.9)),
      ]);
      paths.push({
        points: normPoints,
        closed,
        width: strokeWidth,
      });
    }
  }

  return paths;
}

/**
 * Serialises extracted contour `StampPath[]` into a self-contained `custom:...`
 * stamp asset ID that persists cleanly in history and IndexedDB.
 */
export function encodeCustomStampId(paths: StampPath[]): string {
  const body = paths
    .filter((p) => p.points.length >= 2)
    .map((p) => {
      const c = p.closed ? '1' : '0';
      const w = Math.max(1, Math.round(p.width * 1000));
      const pts = p.points
        .map(
          ([x, y]) =>
            `${Math.round(clampUnit(x) * 1000)},${Math.round(clampUnit(y) * 1000)}`,
        )
        .join(';');
      return `${c},${w}:${pts}`;
    })
    .join('|');
  return `${CUSTOM_STAMP_PREFIX}${body}`;
}

/**
 * Decodes a `custom:...` stamp asset ID back into deterministic `StampGeometry`.
 * Returns `undefined` when the ID is not a valid custom contour stamp.
 */
export function decodeCustomStampId(id: string): StampGeometry | undefined {
  if (!id.startsWith(CUSTOM_STAMP_PREFIX)) return undefined;
  const rawBody = id.slice(CUSTOM_STAMP_PREFIX.length);
  if (!rawBody) return undefined;
  const paths: StampPath[] = [];
  for (const segment of rawBody.split('|')) {
    const colonIdx = segment.indexOf(':');
    if (colonIdx <= 0) continue;
    const header = segment.slice(0, colonIdx).split(',');
    const ptsRaw = segment.slice(colonIdx + 1).split(';');
    if (header.length !== 2 || ptsRaw.length < 2) continue;
    const closed = header[0] === '1';
    const widthInt = Number(header[1]);
    if (!Number.isFinite(widthInt) || widthInt <= 0) continue;
    const points: [number, number][] = [];
    for (const pair of ptsRaw) {
      const coords = pair.split(',');
      if (coords.length !== 2) continue;
      const x = Number(coords[0]) / 1000;
      const y = Number(coords[1]) / 1000;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push([clampUnit(x), clampUnit(y)]);
      }
    }
    if (points.length >= 2) {
      paths.push({
        points,
        closed,
        width: widthInt / 1000,
      });
    }
  }
  return paths.length > 0 ? { paths } : undefined;
}
