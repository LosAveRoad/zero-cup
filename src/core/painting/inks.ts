/**
 * 青花钴料的三档浓淡。
 *
 * 纯数据模块：渲染器与工具面板共用同一份配方，避免渲染器反向依赖 UI 组件。
 */

export interface CobaltInk {
  value: string;
  label: string;
  /** 落笔时的不透明度，模拟分水的浓淡。 */
  opacity: number;
}

export const INKS: readonly CobaltInk[] = [
  { value: '#174a94', label: '浓青', opacity: 1 },
  { value: '#547fb2', label: '中青', opacity: 0.78 },
  { value: '#9ab6d5', label: '淡青', opacity: 0.55 },
];

/** Maps a cobalt ink colour to its traditional water-splitting (分水) opacity. */
export function inkOpacityFor(color: string): number {
  return INKS.find((ink) => ink.value === color)?.opacity ?? 1;
}
