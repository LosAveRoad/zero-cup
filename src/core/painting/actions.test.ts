import { describe, expect, it } from 'vitest';
import {
  actionPath,
  brushAction,
  eraseAction,
  isErase,
  isStamp,
  paintsInk,
  stampAction,
} from './actions';

describe('painting command factories', () => {
  it('builds brush commands with a default opacity and a copied path', () => {
    const path = [{ u: 0.1, v: 0.2 }];
    const action = brushAction(path, { size: 24, color: '#174a94' });
    expect(action).toEqual({
      type: 'BRUSH',
      path: [{ u: 0.1, v: 0.2 }],
      color: '#174a94',
      opacity: 1,
      size: 24,
    });
    path[0].u = 0.9;
    expect(action.type === 'BRUSH' && action.path[0].u).toBe(0.1);
  });

  it('keeps an explicit brush opacity', () => {
    const action = brushAction([], {
      size: 12,
      color: '#547fb2',
      opacity: 0.4,
    });
    expect(action.type === 'BRUSH' && action.opacity).toBe(0.4);
  });

  it('builds erase commands with a copied path', () => {
    const path = [{ u: 0.3, v: 0.4 }];
    const action = eraseAction(path, 30);
    expect(action).toEqual({
      type: 'ERASE',
      path: [{ u: 0.3, v: 0.4 }],
      size: 30,
    });
    path[0].v = 0.9;
    expect(action.type === 'ERASE' && action.path[0].v).toBe(0.4);
  });

  it('builds stamp commands with default scale and rotation', () => {
    expect(
      stampAction(0.5, 0.5, { assetId: 'lotus', color: '#174a94' }),
    ).toEqual({
      type: 'STAMP',
      u: 0.5,
      v: 0.5,
      assetId: 'lotus',
      color: '#174a94',
      scale: 1,
      rotation: 0,
    });
    expect(
      stampAction(0.2, 0.3, {
        assetId: 'cloud',
        color: '#9ab6d5',
        scale: 1.5,
        rotation: Math.PI,
      }),
    ).toMatchObject({ scale: 1.5, rotation: Math.PI });
  });

  it('exposes the dragged path of brush and erase commands only', () => {
    const path = [{ u: 0.5, v: 0.5 }];
    expect(
      actionPath(brushAction(path, { size: 24, color: '#174a94' })),
    ).toEqual(path);
    expect(actionPath(eraseAction(path, 24))).toEqual(path);
    expect(
      actionPath(stampAction(0.5, 0.5, { assetId: 'lotus', color: '#174a94' })),
    ).toEqual([]);
  });

  it('classifies commands', () => {
    const brush = brushAction([], { size: 24, color: '#174a94' });
    const erase = eraseAction([], 24);
    const stamp = stampAction(0.5, 0.5, { assetId: 'lotus', color: '#174a94' });
    expect(isErase(brush)).toBe(false);
    expect(isErase(erase)).toBe(true);
    expect(isStamp(stamp)).toBe(true);
    expect(isStamp(brush)).toBe(false);
    expect(paintsInk(brush)).toBe(true);
    expect(paintsInk(stamp)).toBe(true);
    expect(paintsInk(erase)).toBe(false);
  });
});
