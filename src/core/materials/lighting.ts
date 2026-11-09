/**
 * 窑内光照配方。
 *
 * 纯数据模块：不引入 React / Three.js / DOM，也不持有任何 GPU 资源。
 * 渲染器读取 `LightRig` 并把它套用到自己的 HemisphereLight / DirectionalLight。
 */

/** 单盏灯的描述。 */
export interface LightDescriptor {
  /** 十六进制颜色，形如 '#rrggbb' */
  color: string;
  intensity: number;
  /** 灯光位置（世界坐标） */
  position: [number, number, number];
}

/** 半球环境光的描述。 */
export interface AmbientDescriptor {
  /** 天顶颜色 */
  sky: string;
  /** 地面反射颜色 */
  ground: string;
  intensity: number;
}

/** 一整套灯光。 */
export interface LightRig {
  ambient: AmbientDescriptor;
  /** 主光：塑造器型与釉面高光 */
  key: LightDescriptor;
  /** 轮廓光：冷色边缘 */
  rim: LightDescriptor;
  /** 补光：压暗部，避免死黑 */
  fill: LightDescriptor;
}

/**
 * 成品光位：强主光 + 冷轮廓光 + 柔补光。
 * 环境光压低、主光抬高，釉面才会出现清晰的陶瓷高光。
 */
export const STUDIO_LIGHT_RIG: LightRig = {
  ambient: { sky: '#eef4ff', ground: '#6c6259', intensity: 1.35 },
  key: { color: '#fff6ea', intensity: 4.2, position: [3, 5, 4] },
  rim: { color: '#a9cdff', intensity: 2.6, position: [-4, 3, -2] },
  fill: { color: '#dce7f2', intensity: 0.9, position: [-2.6, 1.8, 3.2] },
};

/**
 * 素坯光位：环境光高、方向光弱且柔，坯体呈均匀的哑光，
 * 此时器物还不该出现釉面高光。
 */
export const BISQUE_LIGHT_RIG: LightRig = {
  ambient: { sky: '#f6f1e7', ground: '#8d8377', intensity: 2.4 },
  key: { color: '#fbf1de', intensity: 1.5, position: [3, 5, 4] },
  rim: { color: '#cdd8e4', intensity: 0.7, position: [-4, 3, -2] },
  fill: { color: '#eae3d6', intensity: 1.2, position: [-2.6, 1.8, 3.2] },
};

/** 成品展厅可用的三档布光方案标识。 */
export type LightingPresetId = 'studio' | 'warm' | 'celadon';

/** 博古暖光：博物馆暖金射灯氛围，突出青花温润包浆感。 */
export const WARM_LIGHT_RIG: LightRig = {
  ambient: { sky: '#fff5e4', ground: '#78624d', intensity: 1.45 },
  key: { color: '#ffe8c8', intensity: 4.5, position: [3.4, 4.8, 3.8] },
  rim: { color: '#ffd4a3', intensity: 2.2, position: [-3.8, 3.2, -2.2] },
  fill: { color: '#f7e5ce', intensity: 1.05, position: [-2.4, 2.0, 3.0] },
};

/** 天青雅光：清冷雨过天青光泽，强化高光白釉与钴蓝对比。 */
export const CELADON_LIGHT_RIG: LightRig = {
  ambient: { sky: '#e3f2ff', ground: '#596873', intensity: 1.3 },
  key: { color: '#f2f8ff', intensity: 4.1, position: [2.8, 5.2, 4.2] },
  rim: { color: '#8ac2ff', intensity: 3.0, position: [-4.2, 3.4, -1.8] },
  fill: { color: '#d0e6f8', intensity: 0.85, position: [-2.8, 1.6, 3.4] },
};

export const EXHIBITION_LIGHT_PRESETS: Record<LightingPresetId, LightRig> = {
  studio: STUDIO_LIGHT_RIG,
  warm: WARM_LIGHT_RIG,
  celadon: CELADON_LIGHT_RIG,
};

/** 获取成品展厅指定预设的灯光配置（默认返回标准展厅光位）。 */
export function exhibitionRigFor(
  preset: LightingPresetId = 'studio',
): LightRig {
  return EXHIBITION_LIGHT_PRESETS[preset] ?? STUDIO_LIGHT_RIG;
}

/**
 * 线性插值。端点直接返回原值，保证 t=0 / t=1 时与原始配方完全一致，
 * 不会出现 1 + (2 - 1) * 1 !== 2 这类浮点误差。
 */
function lerp(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

/**
 * 取十六进制颜色的第 index 个通道（0=红, 1=绿, 2=蓝）。
 *
 * 本模块只处理自身常量使用的 '#rrggbb' 形式；无法解析的字符按 0 处理，
 * 因此不会产生 NaN 颜色。
 */
function channelAt(hex: string, index: number): number {
  const raw = hex.trim().replace(/^#/, '');
  return parseInt(raw.slice(index * 2, index * 2 + 2), 16) & 255;
}

/** 两个通道值转成两位小写十六进制。 */
function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** 在 sRGB 十六进制色之间线性混合。 */
function mixHex(from: string, to: string, t: number): string {
  const mix = (index: number) =>
    Math.round(
      channelAt(from, index) +
        (channelAt(to, index) - channelAt(from, index)) * t,
    );
  return `#${hex2(mix(0))}${hex2(mix(1))}${hex2(mix(2))}`;
}

/** 混合两个灯位描述。 */
function mixLight(
  from: LightDescriptor,
  to: LightDescriptor,
  t: number,
): LightDescriptor {
  return {
    color: mixHex(from.color, to.color, t),
    intensity: lerp(from.intensity, to.intensity, t),
    position: [
      lerp(from.position[0], to.position[0], t),
      lerp(from.position[1], to.position[1], t),
      lerp(from.position[2], to.position[2], t),
    ],
  };
}

/**
 * 按烧制进度混合两套光位。
 *
 * 入参是**已缓动**的进度（通常来自 `glazeProgress`）：
 * 0 = 素坯光位，1 = 成品光位，超出范围会被夹取，非法值按 0 处理。
 */
export function rigAt(progress: number): LightRig {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return {
    ambient: {
      sky: mixHex(
        BISQUE_LIGHT_RIG.ambient.sky,
        STUDIO_LIGHT_RIG.ambient.sky,
        t,
      ),
      ground: mixHex(
        BISQUE_LIGHT_RIG.ambient.ground,
        STUDIO_LIGHT_RIG.ambient.ground,
        t,
      ),
      intensity: lerp(
        BISQUE_LIGHT_RIG.ambient.intensity,
        STUDIO_LIGHT_RIG.ambient.intensity,
        t,
      ),
    },
    key: mixLight(BISQUE_LIGHT_RIG.key, STUDIO_LIGHT_RIG.key, t),
    rim: mixLight(BISQUE_LIGHT_RIG.rim, STUDIO_LIGHT_RIG.rim, t),
    fill: mixLight(BISQUE_LIGHT_RIG.fill, STUDIO_LIGHT_RIG.fill, t),
  };
}
