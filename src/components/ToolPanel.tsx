import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  encodeCustomStampId,
  extractImageContours,
  type ContourDetailLevel,
} from '../core/painting/contour';
import { INKS } from '../core/painting/inks';
import {
  STAMP_ASSETS,
  STAMP_ROTATION_RANGE,
  STAMP_SCALE_RANGE,
  type StampAssetId,
} from '../core/painting/stamps';
import {
  MASTERPIECE_PRESETS,
  SYMMETRY_OPTIONS,
  type MasterpiecePresetId,
} from '../core/painting/strokes';
import type { PaintTool, SymmetryCount } from '../types/artwork';

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
  symmetry?: SymmetryCount;
  onSymmetryChange?: (symmetry: SymmetryCount) => void;
  ringBand?: boolean;
  onRingBandChange?: (ringBand: boolean) => void;
  onApplyMasterpiece?: (presetId: MasterpiecePresetId) => void;
  onImprintContour?: (customStampId: StampAssetId) => void;
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
  symmetry = 1,
  onSymmetryChange,
  ringBand = false,
  onRingBandChange,
  onApplyMasterpiece,
  onImprintContour,
  disabled = false,
}: ToolPanelProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedImage, setImportedImage] = useState<{
    name: string;
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
  } | null>(null);
  const [contourDetail, setContourDetail] =
    useState<ContourDetailLevel>('medium');
  const [contourInvert, setContourInvert] = useState(false);

  // Extracting contours walks every pixel: keep it off the render path so
  // dragging a radius slider does not re-run Sobel on each frame.
  const contourPaths = useMemo(
    () =>
      importedImage
        ? extractImageContours(
            importedImage.rgba,
            importedImage.width,
            importedImage.height,
            {
              detail: contourDetail,
              invert: contourInvert,
            },
          )
        : [],
    [importedImage, contourDetail, contourInvert],
  );
  const customStampId =
    contourPaths.length > 0
      ? (encodeCustomStampId(contourPaths) as StampAssetId)
      : undefined;

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 80;
      const scale = Math.min(
        maxDim / Math.max(1, img.naturalWidth || img.width),
        maxDim / Math.max(1, img.naturalHeight || img.height),
      );
      const drawW = Math.max(
        8,
        Math.round((img.naturalWidth || img.width) * scale),
      );
      const drawH = Math.max(
        8,
        Math.round((img.naturalHeight || img.height) * scale),
      );
      const pad = 4;
      const canvas = document.createElement('canvas');
      canvas.width = drawW + pad * 2;
      canvas.height = drawH + pad * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = contourInvert ? '#000000' : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, drawW, drawH);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      setImportedImage({
        name: file.name.replace(/\.[^.]+$/, '') || '导入图案',
        rgba,
        width: canvas.width,
        height: canvas.height,
      });
      const extracted = extractImageContours(
        rgba,
        canvas.width,
        canvas.height,
        {
          detail: contourDetail,
          invert: contourInvert,
        },
      );
      if (extracted.length > 0) {
        const nextId = encodeCustomStampId(extracted) as StampAssetId;
        onToolChange('stamp');
        onStampAssetChange(nextId);
        onImprintContour?.(nextId);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
    event.target.value = '';
  }

  function updateContourOption(
    nextDetail: ContourDetailLevel,
    nextInvert: boolean,
  ) {
    setContourDetail(nextDetail);
    setContourInvert(nextInvert);
    if (!importedImage) return;
    const extracted = extractImageContours(
      importedImage.rgba,
      importedImage.width,
      importedImage.height,
      {
        detail: nextDetail,
        invert: nextInvert,
      },
    );
    if (extracted.length > 0) {
      const nextId = encodeCustomStampId(extracted) as StampAssetId;
      onToolChange('stamp');
      onStampAssetChange(nextId);
    }
  }

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
            {customStampId && (
              <button
                type="button"
                aria-label="导入图样"
                aria-pressed={stampAssetId.startsWith('custom:')}
                disabled={disabled}
                onClick={() => onStampAssetChange(customStampId)}
              >
                导入图样
              </button>
            )}
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
      <div className="image-contour-workshop">
        <span className="control-caption">瓶身图案导入（轮廓特征拓印）</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="导入图案图片"
          disabled={disabled}
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        <button
          type="button"
          className="contour-upload-btn"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          {importedImage ? '更换导入图片' : '导入图片印上瓶身'}
        </button>
        {importedImage && (
          <div className="contour-preview-card">
            <div className="contour-preview-header">
              <span className="contour-file-name">{importedImage.name}</span>
              <small className="muted">
                {contourPaths.length > 0
                  ? `已提取 ${contourPaths.length} 笔轮廓`
                  : '未检出明显轮廓'}
              </small>
            </div>
            <svg
              className="contour-preview-svg"
              viewBox="-1 -1 2 2"
              aria-label="导入图案青花轮廓预览"
            >
              {contourPaths.map((path, idx) => {
                const d = path.points
                  .map(
                    ([x, y], i) =>
                      `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${(-y).toFixed(3)}`,
                  )
                  .join(' ');
                return (
                  <path
                    key={idx}
                    d={path.closed ? `${d} Z` : d}
                    fill="none"
                    stroke={color}
                    strokeWidth={path.width * 1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
            <div
              className="contour-detail-row"
              role="group"
              aria-label="轮廓精细度"
            >
              {(
                [
                  { id: 'bold', label: '简练' },
                  { id: 'medium', label: '适中' },
                  { id: 'fine', label: '细腻' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip-btn"
                  aria-pressed={contourDetail === item.id}
                  disabled={disabled}
                  onClick={() => updateContourOption(item.id, contourInvert)}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className="chip-btn"
                aria-pressed={contourInvert}
                disabled={disabled}
                onClick={() =>
                  updateContourOption(contourDetail, !contourInvert)
                }
              >
                反相
              </button>
            </div>
            {customStampId && (
              <button
                type="button"
                className="contour-imprint-btn"
                disabled={disabled}
                onClick={() => {
                  onToolChange('stamp');
                  onStampAssetChange(customStampId);
                  onImprintContour?.(customStampId);
                }}
              >
                印至当前瓶面
              </button>
            )}
          </div>
        )}
      </div>

      {tool !== 'eraser' && onSymmetryChange && (
        <div className="symmetry-workshop">
          <span className="control-caption">非遗对称旋绘工坊</span>
          <div className="symmetry-grid" role="group" aria-label="对称阵列">
            {SYMMETRY_OPTIONS.map((option) => (
              <button
                key={option.count}
                type="button"
                className="chip-btn"
                aria-pressed={symmetry === option.count && !ringBand}
                disabled={disabled}
                onClick={() => {
                  onRingBandChange?.(false);
                  onSymmetryChange(option.count);
                }}
              >
                {option.name}
              </button>
            ))}
          </div>
          {tool === 'brush' && onRingBandChange && (
            <button
              type="button"
              className="ring-band-toggle"
              aria-pressed={ringBand}
              disabled={disabled}
              onClick={() => onRingBandChange(!ringBand)}
            >
              {ringBand
                ? '◎ 已开启旋坯弦纹（落笔即成水平环线）'
                : '○ 开启旋坯弦纹（拉坯轮一笔成环）'}
            </button>
          )}
        </div>
      )}

      {onApplyMasterpiece && (
        <div className="masterpiece-presets">
          <span className="control-caption">经典名品青花快绘</span>
          <div className="masterpiece-grid">
            {MASTERPIECE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="quiet masterpiece-btn"
                disabled={disabled}
                title={preset.subtitle}
                onClick={() => onApplyMasterpiece(preset.id)}
              >
                <span>{preset.name}</span>
                <small>{preset.subtitle}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
