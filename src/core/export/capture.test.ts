import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_PRESETS,
  EXPORT_SIZE,
  MODEL_HEIGHT,
  formatExportDate,
  layoutFor,
  poseFor,
  type CameraPresetId,
} from './capture';

const MID = MODEL_HEIGHT / 2;

function distance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Angle between the two viewing directions, measured at the focus point. */
function viewAngle(
  a: { position: [number, number, number]; target: [number, number, number] },
  b: { position: [number, number, number]; target: [number, number, number] },
): number {
  const da = [
    a.position[0] - a.target[0],
    a.position[1] - a.target[1],
    a.position[2] - a.target[2],
  ];
  const db = [
    b.position[0] - b.target[0],
    b.position[1] - b.target[1],
    b.position[2] - b.target[2],
  ];
  const dot = da[0] * db[0] + da[1] * db[1] + da[2] * db[2];
  const cos = dot / (Math.hypot(...da) * Math.hypot(...db));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Horizontal azimuth of a camera position, in degrees. */
function azimuth(pose: {
  position: [number, number, number];
  target: [number, number, number];
}): number {
  const dx = pose.position[0] - pose.target[0];
  const dz = pose.position[2] - pose.target[2];
  return (Math.atan2(dx, dz) * 180) / Math.PI;
}

describe('camera presets', () => {
  it('keeps the model height and export size in sync with the renderer', () => {
    expect(MODEL_HEIGHT).toBe(2.8);
    expect(EXPORT_SIZE).toBe(1080);
  });

  it('looks at the vessel from the front, level with its middle', () => {
    const pose = poseFor('front');
    expect(pose.target).toEqual([0, MID, 0]);
    expect(pose.position[2]).toBeGreaterThan(0);
    expect(pose.position[0]).toBe(0);
    expect(pose.position[1]).toBeCloseTo(MID, 6);
    expect(pose.fov).toBeGreaterThan(0);
  });

  it('rotates the front view by exactly 30 degrees around the vertical axis', () => {
    const front = poseFor('front');
    const tilt = poseFor('tilt30');
    expect(viewAngle(front, tilt)).toBeCloseTo(30, 6);
    expect(azimuth(tilt) - azimuth(front)).toBeCloseTo(30, 6);
    expect(distance(tilt.position, tilt.target)).toBeCloseTo(
      distance(front.position, front.target),
      6,
    );
    expect(tilt.target).toEqual(front.target);
  });

  it('moves closer for the close-up without moving the focus point', () => {
    const front = poseFor('front');
    const closeup = poseFor('closeup');
    expect(distance(closeup.position, closeup.target)).toBeLessThan(
      distance(front.position, front.target),
    );
    expect(closeup.target).toEqual(front.target);
  });

  it('falls back to the front pose for free rotation', () => {
    expect(poseFor('free')).toEqual(poseFor('front'));
  });

  it('keeps every preset inside the model bounds with a usable lens', () => {
    const ids: CameraPresetId[] = ['front', 'tilt30', 'closeup', 'free'];
    for (const id of ids) {
      const pose = poseFor(id);
      expect(pose.fov).toBeGreaterThan(0);
      expect(pose.target[1]).toBeGreaterThanOrEqual(0);
      expect(pose.target[1]).toBeLessThanOrEqual(MODEL_HEIGHT);
      expect(distance(pose.position, pose.target)).toBeGreaterThan(0);
      expect(pose.position.every(Number.isFinite)).toBe(true);
    }
  });

  it('exposes the three canonical presets and copies their data', () => {
    expect(Object.keys(CAMERA_PRESETS).sort()).toEqual([
      'closeup',
      'front',
      'tilt30',
    ]);
    const pose = poseFor('front');
    pose.position[0] = 99;
    expect(CAMERA_PRESETS.front.position[0]).toBe(0);
  });
});

describe('export layout', () => {
  it('exports a square 1080 canvas with name, date and seal', () => {
    const layout = layoutFor({
      name: '端到端青花瓶',
      date: new Date(2026, 10, 8),
    });
    expect(layout.width).toBe(EXPORT_SIZE);
    expect(layout.height).toBe(EXPORT_SIZE);
    expect(layout.title).toBe('端到端青花瓶');
    expect(layout.subtitle).toBe('2026年11月8日');
    expect(layout.seal).toBe('瓷器物语');
    expect(layout.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(layout.titleFont).toBeGreaterThan(0);
    expect(layout.subtitleFont).toBeGreaterThan(0);
  });

  it('truncates the title but never the date', () => {
    const long = '青'.repeat(40);
    const layout = layoutFor({ name: long, date: new Date(2026, 10, 8) });
    expect(layout.title).toHaveLength(28);
    expect(layout.subtitle).toBe(formatExportDate(new Date(2026, 10, 8)));
    expect(layout.subtitle).not.toContain('…');
  });

  it('falls back to a placeholder for a blank name', () => {
    expect(layoutFor({ name: '   ' }).title).toBe('未命名作品');
  });

  it('keeps the caption band below the photo and the seal on the photo', () => {
    const layout = layoutFor({ name: '器' });
    expect(layout.footerY).toBeGreaterThan(0);
    expect(layout.footerY).toBeLessThan(layout.height);
    expect(layout.titleY).toBeGreaterThan(layout.footerY);
    expect(layout.subtitleY).toBeGreaterThan(layout.titleY);
    expect(layout.sealY).toBeLessThan(layout.footerY);
    expect(layout.sealX + layout.sealSize).toBeLessThanOrEqual(layout.width);
    expect(layout.sealY + layout.sealSize).toBeLessThanOrEqual(layout.height);
  });
});

describe('export date', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats year, month and day in Chinese style', () => {
    expect(formatExportDate(new Date(2026, 10, 8))).toBe('2026年11月8日');
    expect(formatExportDate(new Date(2026, 0, 1))).toBe('2026年1月1日');
  });

  it('uses the current date when no date is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 10, 30));
    expect(formatExportDate()).toBe('2026年11月8日');
    expect(layoutFor({ name: '器' }).subtitle).toBe('2026年11月8日');
  });
});
