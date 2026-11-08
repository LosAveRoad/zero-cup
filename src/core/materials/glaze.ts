/**
 * 烧制材质配方与进度曲线。
 *
 * 纯数据模块：不引入 React / Three.js / DOM。
 * 本文件只描述「素坯 → 白釉」的材质配方、进度曲线与阶段划分，
 * 由渲染器（studio-renderer.ts）读取并应用到 MeshPhysicalMaterial。
 */

/** 统一的烧制时长（毫秒）。整个应用只有这一个时长常量。 */
export const FIRING_DURATION_MS = 2500;

/** 一次烧制中材质所处的配方快照。 */
export interface GlazeRecipe {
  /** 配方名（中文），用于界面展示 */
  name: string;
  /** 基础色（hex）。与彩绘贴图相乘，决定青花由灰蓝转向钴蓝 */
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenColor: string;
}

/** 素坯：粗糙、无釉、无高光。 */
export const BISQUE_RECIPE: GlazeRecipe = {
  name: '素坯',
  color: '#d5c8b6',
  roughness: 0.85,
  metalness: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.05,
  sheen: 0,
  sheenColor: '#e8e0d2',
};

/** 白釉：细腻釉面 + 清漆层，出窑后的高光瓷质。 */
export const WHITE_GLAZE_RECIPE: GlazeRecipe = {
  name: '白釉',
  color: '#ffffff',
  roughness: 0.15,
  metalness: 0.05,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  sheen: 0.25,
  sheenColor: '#fff3e2',
};

/** 烧制阶段标签。 */
export type FiringStage = 'bisque' | 'rising' | 'glazing' | 'complete';

/** 进入升温阶段的进度阈值。 */
const RISING_AT = 0.15;
/** 进入挂釉阶段的进度阈值。 */
const GLAZING_AT = 0.65;

/**
 * 窑火曲线（smootherstep）。
 *
 * 该曲线在 t=0 与 t=1 处的斜率和曲率都为 0，因此 PBR 参数的两端不会
 * 出现速度突变：起火时坯体几乎不动，中段釉面快速熔融，末段缓慢收束
 * 成瓷。整个过渡在视觉上是一次连续的爬升，而不是一次跳变。
 */
function kilnCurve(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 把 '#rgb' / '#rrggbb' 解析成 0-255 的三元组；无法解析时返回 null。 */
function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3 ? raw.replace(/./g, (char) => char + char) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** 在 sRGB 十六进制色之间线性混合，保证端点取值完全一致。 */
function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  // 无法解析的颜色保持原样，避免用一个猜测值污染整条曲线。
  if (!a) return from;
  if (!b) return to;
  if (t <= 0) return from;
  if (t >= 1) return to;
  const red = Math.round(a[0] + (b[0] - a[0]) * t);
  const green = Math.round(a[1] + (b[1] - a[1]) * t);
  const blue = Math.round(a[2] + (b[2] - a[2]) * t);
  const channel = (value: number) => value.toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * 线性时间（毫秒）→ 缓动后的 0..1 进度。
 *
 * - `glazeProgress(0) === 0`，`glazeProgress(durationMs) === 1`
 * - 超出范围的输入被夹取到 [0, 1]；NaN 视为 0
 * - `durationMs` 非法（非有限数或非正数）时回退到 FIRING_DURATION_MS
 */
export function glazeProgress(
  elapsedMs: number,
  durationMs: number = FIRING_DURATION_MS,
): number {
  const duration =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : FIRING_DURATION_MS;
  if (Number.isNaN(elapsedMs)) return 0;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= duration) return 1;
  return kilnCurve(elapsedMs / duration);
}

/** 把进度映射成界面用的粗粒度阶段标签。 */
export function firingStage(progress: number): FiringStage {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  if (p >= 1) return 'complete';
  if (p >= GLAZING_AT) return 'glazing';
  if (p >= RISING_AT) return 'rising';
  return 'bisque';
}

/** 混合两份配方；`t` 会被夹取到 [0, 1]。 */
export function interpolateRecipe(
  from: GlazeRecipe,
  to: GlazeRecipe,
  t: number,
): GlazeRecipe {
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const blend = (a: number, b: number) =>
    k <= 0 ? a : k >= 1 ? b : a + (b - a) * k;
  return {
    name: k < 0.5 ? from.name : to.name,
    color: mixHex(from.color, to.color, k),
    roughness: blend(from.roughness, to.roughness),
    metalness: blend(from.metalness, to.metalness),
    clearcoat: blend(from.clearcoat, to.clearcoat),
    clearcoatRoughness: blend(from.clearcoatRoughness, to.clearcoatRoughness),
    sheen: blend(from.sheen, to.sheen),
    sheenColor: mixHex(from.sheenColor, to.sheenColor, k),
  };
}

/**
 * 素坯 → 白釉 的配方曲线。
 *
 * 入参是**已缓动**的进度（通常来自 `glazeProgress`）。
 */
export function recipeAt(progress: number): GlazeRecipe {
  return interpolateRecipe(BISQUE_RECIPE, WHITE_GLAZE_RECIPE, progress);
}
