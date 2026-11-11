import type {
  PaintingAction,
  SymmetryCount,
  UVPoint,
} from '../../types/artwork';

/**
 * Factories for the persisted painting command union.
 *
 * Every action is built here so that the renderer, the history stack and the
 * IndexedDB layer all agree on one immutable shape. Paths are copied on the
 * way in so later mutation of the caller's array cannot corrupt history.
 */
export function brushAction(
  path: UVPoint[],
  options: {
    size: number;
    color: string;
    opacity?: number;
    symmetry?: SymmetryCount;
  },
): PaintingAction {
  const base: PaintingAction = {
    type: 'BRUSH',
    path: path.map((point) => ({ ...point })),
    color: options.color,
    opacity: options.opacity ?? 1,
    size: options.size,
  };
  if (options.symmetry && options.symmetry > 1) {
    base.symmetry = options.symmetry;
  }
  return base;
}

export function eraseAction(path: UVPoint[], size: number): PaintingAction {
  return { type: 'ERASE', path: path.map((point) => ({ ...point })), size };
}

export function stampAction(
  u: number,
  v: number,
  options: {
    assetId: string;
    color: string;
    scale?: number;
    rotation?: number;
    footprint?: UVPoint;
    symmetry?: SymmetryCount;
    repeatCount?: number;
  },
): PaintingAction {
  const base: PaintingAction = {
    type: 'STAMP',
    u,
    v,
    assetId: options.assetId,
    color: options.color,
    scale: options.scale ?? 1,
    rotation: options.rotation ?? 0,
    ...(options.footprint ? { footprint: { ...options.footprint } } : {}),
  };
  if (options.symmetry && options.symmetry > 1) {
    base.symmetry = options.symmetry;
  }
  if (options.repeatCount && options.repeatCount > 1) {
    base.repeatCount = options.repeatCount;
  }
  return base;
}

/** The dragged path of a brush or erase command; stamps have no path. */
export function actionPath(action: PaintingAction): UVPoint[] {
  if (action.type === 'STAMP') return [];
  return action.path.map((point) => ({ ...point }));
}

export function isErase(action: PaintingAction): boolean {
  return action.type === 'ERASE';
}

export function isStamp(action: PaintingAction): boolean {
  return action.type === 'STAMP';
}

/** True when the command puts ink on the canvas rather than removing it. */
export function paintsInk(action: PaintingAction): boolean {
  return action.type !== 'ERASE';
}
