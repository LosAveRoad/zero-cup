import {
  STAMP_ASSETS,
  STAMP_ROTATION_RANGE,
  STAMP_SCALE_RANGE,
  type StampAssetId,
} from '../core/painting/stamps';
import type { PaintTool } from '../types/artwork';

/** The painting tools that can be active at the same time. */
export type ToolId = PaintTool;

export interface ToolPanelProps {
  tool: ToolId;
  onToolChange: (tool: ToolId) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  color: string;
  onColorChange: (color: string) => void;
  stampAssetId: StampAssetId;
  onStampAssetChange: (id: StampAssetId) => void;
  stampScale: number;
  onStampScaleChange: (scale: number) => void;
  stampRotation: number;
  onStampRotationChange: (rotation: number) => void;
  disabled?: boolean;
}

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'brush', label: '画笔' },
  { id: 'eraser', label: '橡皮擦' },
  { id: 'stamp', label: '印章' },
];

const SIZES: { value: number; label: string }[] = [
  { value: 12, label: '细' },
  { value: 24, label: '中' },
  { value: 48, label: '粗' },
];

const INKS: { value: string; label: string }[] = [
  { value: '#174a94', label: '浓青' },
  { value: '#547fb2', label: '中青' },
  { value: '#9ab6d5', label: '淡青' },
];

/**
 * The current-tool context panel of the painting stage.
 *
 * Exactly one tool is active; the controls below follow the active tool.
 * Scale and rotation belong to the *next* stamp only — they are read once,
 * when a stamp is placed, and never applied to stamps that already exist.
 */
export function ToolPanel({
  tool,
  onToolChange,
  brushSize,
  onBrushSizeChange,
  color,
  onColorChange,
  stampAssetId,
  onStampAssetChange,
  stampScale,
  onStampScaleChange,
  stampRotation,
  onStampRotationChange,
  disabled = false,
}: ToolPanelProps): JSX.Element {
  // The rotation slider works in whole degrees so that 0 is exactly
  // reachable, while the value handed back to the app stays in radians.
  const rotationDegrees = Math.round(
    (Math.min(
      Math.max(stampRotation, STAMP_ROTATION_RANGE.min),
      STAMP_ROTATION_RANGE.max,
    ) *
      180) /
      Math.PI,
  );
  return (
    <div className="tool-panel">
      <div className="segmented" role="group" aria-label="绘制工具">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={tool === item.id}
            disabled={disabled}
            onClick={() => onToolChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tool === 'brush' && (
        <>
          <label>
            笔刷粗细
            <select
              aria-label="笔刷粗细"
              disabled={disabled}
              value={brushSize}
              onChange={(event) =>
                onBrushSizeChange(Number(event.target.value))
              }
            >
              {SIZES.map((size) => (
                <option key={size.value} value={size.value}>
                  {size.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            青花浓度
            <select
              aria-label="青花浓度"
              disabled={disabled}
              value={color}
              onChange={(event) => onColorChange(event.target.value)}
            >
              {INKS.map((ink) => (
                <option key={ink.value} value={ink.value}>
                  {ink.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {tool === 'eraser' && (
        <label>
          橡皮擦粗细
          <select
            aria-label="橡皮擦粗细"
            disabled={disabled}
            value={brushSize}
            onChange={(event) => onBrushSizeChange(Number(event.target.value))}
          >
            {SIZES.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {tool === 'stamp' && (
        <>
          <div className="segmented" role="group" aria-label="印章样式">
            {STAMP_ASSETS.map((asset) => (
              <button
                key={asset.id}
                type="button"
                aria-label={asset.name}
                aria-pressed={stampAssetId === asset.id}
                disabled={disabled}
                onClick={() => onStampAssetChange(asset.id)}
              >
                {asset.name}
              </button>
            ))}
          </div>
          <label>
            印章缩放
            <input
              aria-label="印章缩放"
              type="range"
              min={STAMP_SCALE_RANGE.min}
              max={STAMP_SCALE_RANGE.max}
              step={0.05}
              disabled={disabled}
              value={stampScale}
              onChange={(event) =>
                onStampScaleChange(Number(event.target.value))
              }
            />
            <span className="muted">{stampScale.toFixed(2)} 倍</span>
          </label>
          <label>
            印章旋转
            <input
              aria-label="印章旋转"
              type="range"
              min={-180}
              max={180}
              step={1}
              disabled={disabled}
              value={rotationDegrees}
              onChange={(event) =>
                onStampRotationChange(
                  (Number(event.target.value) * Math.PI) / 180,
                )
              }
            />
            <span className="muted">{rotationDegrees}°</span>
          </label>
          <p className="muted">缩放/旋转仅作用于下一次落印</p>
          <label>
            青花浓度
            <select
              aria-label="青花浓度"
              disabled={disabled}
              value={color}
              onChange={(event) => onColorChange(event.target.value)}
            >
              {INKS.map((ink) => (
                <option key={ink.value} value={ink.value}>
                  {ink.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
