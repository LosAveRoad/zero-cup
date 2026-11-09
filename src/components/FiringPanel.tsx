import type { CSSProperties } from 'react';
import { FIRING_DURATION_MS, kilnTelemetryFor } from '../core/materials/glaze';

export interface FiringPanelProps {
  /** 烧制进度，0..1 */
  progress: number;
  stage: 'bisque' | 'rising' | 'glazing' | 'complete';
  /** 烧制总时长，默认 2500ms */
  durationMs?: number;
}

const STAGE_LABELS: Record<FiringPanelProps['stage'], string> = {
  bisque: '素坯入窑',
  rising: '升温',
  glazing: '挂釉',
  complete: '出窑',
};

/** The kiln blazes for the whole firing, so this heading never changes. */
const HEADING = '窑火正盛';

const STAGE_HINTS: Record<FiringPanelProps['stage'], string> = {
  bisque: '坯体入窑，窑温正升。',
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
  const telemetry = kilnTelemetryFor(clamped);
  const startX = 36;
  const endX = 300;
  const baseY = 172;
  const peakY = 26;
  const p0 = { x: startX, y: baseY };
  const p1 = { x: 118, y: 166 };
  const p2 = { x: 184, y: 32 };
  const p3 = { x: endX, y: peakY };
  const u = 1 - clamped;
  const dotX =
    u * u * u * p0.x +
    3 * u * u * clamped * p1.x +
    3 * u * clamped * clamped * p2.x +
    clamped * clamped * clamped * p3.x;
  const dotY =
    u * u * u * p0.y +
    3 * u * u * clamped * p1.y +
    3 * u * clamped * clamped * p2.y +
    clamped * clamped * clamped * p3.y;
  const fullCurvePath = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
  const areaPath = `${fullCurvePath} L ${endX} ${baseY} L ${startX} ${baseY} Z`;
  return (
    <div className="firing firing-panel">
      <span className="firing-beacon" aria-hidden="true">
        ◉
      </span>
      <h3>{HEADING}</h3>
      <p className="firing-stage">{label}</p>
      <p className="firing-hint">{STAGE_HINTS[stage]}</p>
      <div className="kiln-telemetry-card" aria-hidden="true">
        <div className="kiln-temp-header">
          <div className="kiln-temp-value">{telemetry.temperatureC} °C</div>
        </div>
        <svg
          className="kiln-curve-svg"
          viewBox="0 0 320 202"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="kilnHeatGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#e87a24" />
              <stop offset="50%" stopColor="#dc2f14" />
              <stop offset="100%" stopColor="#9e120a" />
            </linearGradient>
            <linearGradient id="kilnAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e33418" stopOpacity="0.38" />
              <stop offset="70%" stopColor="#f07c2e" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#f07c2e" stopOpacity="0.0" />
            </linearGradient>
            <clipPath id="kilnProgressClip">
              <rect x="0" y="0" width={dotX.toFixed(1)} height="202" />
            </clipPath>
          </defs>
          <line
            x1={startX}
            y1={peakY}
            x2={endX}
            y2={peakY}
            stroke="rgba(184, 58, 30, 0.22)"
            strokeDasharray="4 4"
          />
          <line
            x1={startX}
            y1="99"
            x2={endX}
            y2="99"
            stroke="rgba(184, 58, 30, 0.14)"
            strokeDasharray="3 4"
          />
          <line
            x1={startX}
            y1={baseY}
            x2={endX}
            y2={baseY}
            stroke="rgba(166, 87, 40, 0.34)"
            strokeWidth="1.2"
          />
          <path
            d={fullCurvePath}
            fill="none"
            stroke="rgba(184, 58, 30, 0.22)"
            strokeWidth="2.6"
            strokeDasharray="5 4"
          />
          <g clipPath="url(#kilnProgressClip)">
            <path d={areaPath} fill="url(#kilnAreaFill)" />
            <path
              d={fullCurvePath}
              fill="none"
              stroke="url(#kilnHeatGrad)"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
          </g>
          <circle
            cx={dotX.toFixed(1)}
            cy={dotY.toFixed(1)}
            r="13"
            fill="rgba(224, 32, 14, 0.25)"
          />
          <circle
            cx={dotX.toFixed(1)}
            cy={dotY.toFixed(1)}
            r="6.5"
            fill="#d9220e"
            stroke="#fff9f2"
            strokeWidth="2.4"
          />
          <text
            x="4"
            y={peakY + 4}
            fontSize="10.5"
            fill="#8f3d1e"
            fontWeight="600"
          >
            1310°
          </text>
          <text x="8" y="103" fontSize="10" fill="#a85b36">
            700°
          </text>
          <text x="12" y={baseY + 3} fontSize="10" fill="#a85b36">
            25°
          </text>
          <text x={startX} y="193" fontSize="10.5" fill="#8f3d1e">
            25°C
          </text>
          <text
            x={endX}
            y="193"
            fontSize="10.5"
            textAnchor="end"
            fill="#8f3d1e"
          >
            1310°C
          </text>
        </svg>
      </div>
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
