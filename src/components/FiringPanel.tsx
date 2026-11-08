import type { CSSProperties } from 'react';
import { FIRING_DURATION_MS } from '../core/materials/glaze';

export interface FiringPanelProps {
  /** 烧制进度，0..1 */
  progress: number;
  stage: 'bisque' | 'rising' | 'glazing' | 'complete';
  /** 烧制总时长，默认 2500ms */
  durationMs?: number;
}

const STAGE_LABELS: Record<FiringPanelProps['stage'], string> = {
  bisque: '窑火正盛',
  rising: '升温',
  glazing: '挂釉',
  complete: '完成',
};

const STAGE_HINTS: Record<FiringPanelProps['stage'], string> = {
  bisque: '坯体入窑，窑火正盛。',
  rising: '窑温攀升，坯体由灰转白。',
  glazing: '釉料熔融，青花由灰蓝转钴蓝。',
  complete: '出窑。釉面平润，可以拍照了。',
};

const BAR_TRACK: CSSProperties = {
  width: '100%',
  height: 6,
  marginTop: 14,
  borderRadius: 3,
  background: 'rgba(166, 87, 40, 0.18)',
  overflow: 'hidden',
};

const BAR_FILL: CSSProperties = {
  height: '100%',
  borderRadius: 3,
  background: 'linear-gradient(90deg, #e89846, #a65728)',
  transition: 'width 120ms linear',
};

const REMAINING: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  letterSpacing: '0.04em',
  color: '#a65728',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * 烧制阶段的只读进度面板。
 *
 * 复用 style.css 里既有的 `.firing` 视觉语言（窑火橙 + 脉冲光标），
 * 进度条部分使用内联样式，因此无需修改 style.css 即可正常显示。
 */
export function FiringPanel({
  progress,
  stage,
  durationMs = FIRING_DURATION_MS,
}: FiringPanelProps): JSX.Element {
  const clamped = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  const percent = Math.round(clamped * 100);
  const remainingMs = Math.max(0, (1 - clamped) * durationMs);
  const remainingSeconds = (remainingMs / 1000).toFixed(1);
  const label = STAGE_LABELS[stage];
  return (
    <div className="firing firing-panel">
      <span aria-hidden="true">◉</span>
      <h3>{label}</h3>
      <p>{STAGE_HINTS[stage]}</p>
      <div
        className="firing-progress"
        style={BAR_TRACK}
        role="progressbar"
        aria-label="烧制进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${label} ${percent}%`}
      >
        <div
          className="firing-progress-bar"
          style={{ ...BAR_FILL, width: `${percent}%` }}
        />
      </div>
      <p className="firing-remaining" style={REMAINING}>
        {percent}% · 剩余 {remainingSeconds} 秒
      </p>
    </div>
  );
}
