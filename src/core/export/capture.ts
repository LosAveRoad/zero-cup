/**
 * Capture helpers for the finished-piece (成品) export.
 *
 * This module is pure: no React, no Three.js, no DOM, no canvas. It only
 * describes *what* the renderer should draw — camera poses, the 1080×1080
 * layout and the date line — so the renderer stays the single owner of the
 * canvas.
 *
 * World units come from the renderer: the vessel is a LatheGeometry built
 * from `sampleProfile()` mapped to `new THREE.Vector2(p.radius, p.height * 2.8)`,
 * so the model is MODEL_HEIGHT units tall and its foot rests on the pedestal
 * at y = 0. The presets frame the vessel from the front of that box.
 */

/** Height of the lathe model in world units (profile height 0..1 * 2.8). */
export const MODEL_HEIGHT = 2.8;

/** The exported PNG is always EXPORT_SIZE × EXPORT_SIZE pixels. */
export const EXPORT_SIZE = 1080;

/** Every preset frames the same point: the middle of the vessel. */
const TARGET_HEIGHT = MODEL_HEIGHT / 2;

/** Vertical field of view, matching the renderer camera (38°). */
const CAMERA_FOV = 38;

/** Distance from the focus point to the camera for the straight-on shot. */
const FRONT_DISTANCE = 6.3;

/** The close-up keeps the focus point but moves the camera closer. */
const CLOSEUP_DISTANCE = 4.8;

/** The three-quarter view is the front view rotated by 30° around the Y axis. */
const TILT_ANGLE = (30 * Math.PI) / 180;

/** Longest title drawn on the export, matching the previous export behaviour. */
const MAX_TITLE_LENGTH = 28;

/** Seal stamp text drawn on the export. */
const SEAL_TEXT = '瓷器物语';

/** Mat colour of the caption band at the bottom of the export. */
const MAT_COLOUR = '#f5f2e9';

/** Top edge of the caption band: the band covers [footerY, height]. */
const FOOTER_Y = 940;

/** Baseline of the artwork name inside the caption band. */
const TITLE_Y = 1000;

/** Font size of the artwork name. */
const TITLE_FONT = 28;

/** Baseline of the date line inside the caption band. */
const SUBTITLE_Y = 1034;

/** Font size of the date line. */
const SUBTITLE_FONT = 16;

/** Seal stamp, stamped on the photo just above the caption band. */
const SEAL_X = 900;
const SEAL_Y = 820;
const SEAL_SIZE = 64;

export type CameraPresetId = 'front' | 'tilt30' | 'closeup' | 'free';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/** Rotate a point around the vertical (Y) axis of the world origin. */
function rotateY(
  [x, y, z]: [number, number, number],
  angle: number,
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

/**
 * The recommended camera positions. The camera always sits level with the
 * middle of the vessel, so the silhouette of the pot reads straight on.
 */
export const CAMERA_PRESETS: Record<
  Exclude<CameraPresetId, 'free'>,
  CameraPose
> = {
  front: {
    position: [0, TARGET_HEIGHT, FRONT_DISTANCE],
    target: [0, TARGET_HEIGHT, 0],
    fov: CAMERA_FOV,
  },
  tilt30: {
    position: rotateY([0, TARGET_HEIGHT, FRONT_DISTANCE], TILT_ANGLE),
    target: [0, TARGET_HEIGHT, 0],
    fov: CAMERA_FOV,
  },
  closeup: {
    position: [0, TARGET_HEIGHT, CLOSEUP_DISTANCE],
    target: [0, TARGET_HEIGHT, 0],
    fov: CAMERA_FOV,
  },
};

/**
 * The pose for a preset. 'free' has no canonical pose: return the current
 * 'front' pose (the renderer keeps the user's orbit when 'free' is selected).
 */
export function poseFor(preset: CameraPresetId): CameraPose {
  const pose =
    preset === 'free' ? CAMERA_PRESETS.front : CAMERA_PRESETS[preset];
  return {
    position: [pose.position[0], pose.position[1], pose.position[2]],
    target: [pose.target[0], pose.target[1], pose.target[2]],
    fov: pose.fov,
  };
}

export interface ExportLayout {
  width: number;
  height: number;
  background: string;
  title: string;
  subtitle: string;
  seal: string;
  titleY: number;
  titleFont: number;
  subtitleY: number;
  subtitleFont: number;
  sealX: number;
  sealY: number;
  sealSize: number;
  footerY: number;
}

export interface ExportOptions {
  name: string;
  date?: Date;
  preset?: CameraPresetId;
}

/**
 * The layout used to draw the exported PNG.
 *
 * `footerY` is the top edge of the caption band: the band covers
 * [footerY, height] and is filled with `background`. The name and the date
 * are centred on `width / 2`; the seal is stamped on the photo above the band.
 * `preset` is accepted so the renderer can hand the same options object to
 * `poseFor()`; the layout itself does not depend on it.
 */
export function layoutFor(options: ExportOptions): ExportLayout {
  return {
    width: EXPORT_SIZE,
    height: EXPORT_SIZE,
    background: MAT_COLOUR,
    title: options.name.trim().slice(0, MAX_TITLE_LENGTH) || '未命名作品',
    subtitle: formatExportDate(options.date),
    seal: SEAL_TEXT,
    titleY: TITLE_Y,
    titleFont: TITLE_FONT,
    subtitleY: SUBTITLE_Y,
    subtitleFont: SUBTITLE_FONT,
    sealX: SEAL_X,
    sealY: SEAL_Y,
    sealSize: SEAL_SIZE,
    footerY: FOOTER_Y,
  };
}

/** e.g. '2026年11月8日' */
export function formatExportDate(date?: Date): string {
  const day = date ?? new Date();
  return `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`;
}
