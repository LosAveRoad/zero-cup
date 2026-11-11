import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  encodeCustomStampId,
  extractImageContours,
  type ContourDetailLevel,
} from '../core/painting/contour';
import { INKS } from '../core/painting/inks';
import {
  getStampSvgPaths,
  STAMP_ASSETS,
  STAMP_ROTATION_RANGE,
  STAMP_SCALE_RANGE,
  type StampAssetId,
} from '../core/painting/stamps';
import {
  MASTERPIECE_PRESETS,
  ROTARY_PATTERNS,
  ROTARY_PATTERN_SIZE_RANGE,
  type RotaryPatternId,
  SYMMETRY_OPTIONS,
  type MasterpiecePresetId,
} from '../core/painting/strokes';
import type { PaintTool, SymmetryCount } from '../types/artwork';
import { getArtworkResearch } from '../core/wiki/research';

export type ToolPanelMode = 'draw' | 'template';

export interface ToolPanelProps {
  mode: ToolPanelMode;
  onModeChange: (mode: ToolPanelMode) => void;
  tool: PaintTool;
  onToolChange: (tool: PaintTool) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  color: string;
  onColorChange: (color: string) => void;
  brushOpacity: number;
  onBrushOpacityChange: (opacity: number) => void;
  inkConcentration: number;
  onInkConcentrationChange: (value: number) => void;
  stampAssetId: StampAssetId;
  onStampAssetChange: (id: StampAssetId) => void;
  stampScale: number;
  onStampScaleChange: (scale: number) => void;
  stampRotation: number;
  onStampRotationChange: (rotation: number) => void;
  symmetry: SymmetryCount;
  onSymmetryChange: (symmetry: SymmetryCount) => void;
  rotaryPattern: RotaryPatternId;
  onRotaryPatternChange: (patternId: RotaryPatternId) => void;
  rotaryPatternSize: number;
  onRotaryPatternSizeChange: (size: number) => void;
  onApplyMasterpiece: (presetId: MasterpiecePresetId) => void;
  disabled?: boolean;
}

const TOOLS: { id: PaintTool; label: string }[] = [
  { id: 'brush', label: '画笔' },
  { id: 'eraser', label: '橡皮擦' },
  { id: 'stamp', label: '印章' },
  { id: 'rotary', label: '旋坯环绘' },
];

const CONTOUR_DETAILS: { id: ContourDetailLevel; label: string }[] = [
  { id: 'bold', label: '简练' },
  { id: 'medium', label: '适中' },
  { id: 'fine', label: '细腻' },
];

interface ImportedImage {
  name: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function concentrationColor(value: number): string {
  const ratio = Math.min(1, Math.max(0, value / 100));
  const pale = INKS[2].value;
  const dark = INKS[0].value;
  const channel = (index: number) => {
    const from = Number.parseInt(pale.slice(index, index + 2), 16);
    const to = Number.parseInt(dark.slice(index, index + 2), 16);
    return Math.round(from + (to - from) * ratio)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function StampPreview({
  assetId,
  customPaths,
  color,
  maskUrl,
}: {
  assetId: StampAssetId;
  customPaths?: ReturnType<typeof extractImageContours>;
  color: string;
  maskUrl?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {maskUrl ? (
        <rect
          className="stamp-wash"
          width="100"
          height="100"
          fill={color}
          style={{ maskImage: `url("${maskUrl}")` }}
        />
      ) : (
        getStampSvgPaths(assetId, customPaths).map((path, index) => (
          <path
            key={index}
            d={path.d}
            fill={path.fill === undefined ? 'none' : color}
            fillRule="evenodd"
            fillOpacity={path.fill}
            stroke={path.width === undefined ? undefined : color}
            strokeWidth={path.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))
      )}
    </svg>
  );
}

function RotaryLinePreview({ shape }: { shape: string }): JSX.Element {
  const paths: Record<string, string> = {
    wave: 'M2 50 C12 14 24 14 34 50 S56 86 66 50 S88 14 98 50',
    line: 'M2 50 H98',
    key: 'M2 66 H18 V34 H34 V66 H50 V34 H66 V66 H82 V34 H98',
  };
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path
        d={paths[shape]}
        fill="none"
        stroke="#174a94"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The tool controls, import gallery, rotary brush and quick-paint templates. */
export function ToolPanel({
  mode,
  onModeChange,
  tool,
  onToolChange,
  brushSize,
  onBrushSizeChange,
  color,
  onColorChange,
  brushOpacity,
  onBrushOpacityChange,
  inkConcentration,
  onInkConcentrationChange,
  stampAssetId,
  onStampAssetChange,
  stampScale,
  onStampScaleChange,
  stampRotation,
  onStampRotationChange,
  symmetry,
  onSymmetryChange,
  rotaryPattern,
  onRotaryPatternChange,
  rotaryPatternSize,
  onRotaryPatternSizeChange,
  onApplyMasterpiece,
  disabled = false,
}: ToolPanelProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedImage, setImportedImage] = useState<ImportedImage | null>(
    null,
  );
  const [contourDetail, setContourDetail] =
    useState<ContourDetailLevel>('medium');
  const [contourInvert, setContourInvert] = useState(false);
  const contourPaths = useMemo(
    () =>
      importedImage
        ? extractImageContours(
            importedImage.rgba,
            importedImage.width,
            importedImage.height,
            { detail: contourDetail, invert: contourInvert },
          )
        : [],
    [importedImage, contourDetail, contourInvert],
  );
  const customStampId =
    contourPaths.length > 0
      ? (encodeCustomStampId(contourPaths) as StampAssetId)
      : undefined;
  const rotationDegrees = Math.round((stampRotation * 180) / Math.PI);

  function selectConcentration(value: number) {
    onInkConcentrationChange(value);
    onColorChange(concentrationColor(value));
    onBrushOpacityChange(0.55 + 0.45 * (value / 100));
  }

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
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = contourInvert ? '#000000' : '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, pad, pad, drawW, drawH);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const nextImage = {
        name: file.name.replace(/\.[^.]+$/, '') || '导入图案',
        rgba,
        width: canvas.width,
        height: canvas.height,
      };
      setImportedImage(nextImage);
      const extracted = extractImageContours(
        rgba,
        canvas.width,
        canvas.height,
        { detail: contourDetail, invert: contourInvert },
      );
      if (extracted.length > 0) {
        onToolChange('stamp');
        onStampAssetChange(encodeCustomStampId(extracted) as StampAssetId);
      }
    };
    img.onerror = () => URL.revokeObjectURL(objectUrl);
    img.src = objectUrl;
    event.target.value = '';
  }

  function updateContour(detail: ContourDetailLevel, invert: boolean) {
    setContourDetail(detail);
    setContourInvert(invert);
    if (!importedImage) return;
    const extracted = extractImageContours(
      importedImage.rgba,
      importedImage.width,
      importedImage.height,
      { detail, invert },
    );
    if (extracted.length > 0) {
      const nextId = encodeCustomStampId(extracted) as StampAssetId;
      onStampAssetChange(nextId);
    }
  }

  return (
    <div className="tool-panel">
      <div className="tool-panel-modes" role="group" aria-label="创作内容">
        <button
          type="button"
          aria-pressed={mode === 'draw'}
          onClick={() => onModeChange('draw')}
        >
          绘制
        </button>
        <button
          type="button"
          aria-pressed={mode === 'template'}
          onClick={() => onModeChange('template')}
        >
          模版
        </button>
      </div>

      {mode === 'template' ? (
        <section className="masterpiece-presets" aria-label="经典名品青花快绘">
          <h3>经典名品青花快绘</h3>
          <p className="masterpiece-caption">
            参照大都会艺术博物馆藏品 · 点击铺绘
          </p>
          <div className="masterpiece-grid">
            {MASTERPIECE_PRESETS.map((preset) => {
              const [reference] = getArtworkResearch(preset.reference).objects;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="quiet masterpiece-btn"
                  disabled={disabled}
                  onClick={() => onApplyMasterpiece(preset.id)}
                >
                  <img src={reference.imageUrl} alt="" />
                  <span className="masterpiece-copy">
                    <small>
                      {reference.title} · {reference.date}
                    </small>
                    <strong>{preset.name}</strong>
                    <small>{preset.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <>
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
              <div className="brush-preview" aria-label="当前画笔预览">
                <span>画笔预览</span>
                <svg
                  viewBox="0 0 180 38"
                  role="img"
                  aria-label="画笔颜色与粗细"
                >
                  <line
                    x1="10"
                    y1="19"
                    x2="170"
                    y2="19"
                    stroke={color}
                    strokeWidth={Math.max(2, Math.min(32, brushSize / 2))}
                    strokeLinecap="round"
                    opacity={brushOpacity}
                  />
                </svg>
              </div>
              <label className="range-control">
                笔刷粗细 <output aria-hidden="true">{brushSize}px</output>
                <input
                  aria-label="笔刷粗细"
                  type="range"
                  min={4}
                  max={64}
                  step={1}
                  disabled={disabled}
                  value={brushSize}
                  onChange={(event) =>
                    onBrushSizeChange(Number(event.target.value))
                  }
                />
              </label>
              <label className="range-control">
                青花浓度 <output aria-hidden="true">{inkConcentration}%</output>
                <input
                  aria-label="青花浓度"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  value={inkConcentration}
                  onChange={(event) =>
                    selectConcentration(Number(event.target.value))
                  }
                />
              </label>
            </>
          )}

          {tool === 'eraser' && (
            <label className="range-control">
              橡皮擦粗细 <output aria-hidden="true">{brushSize}px</output>
              <input
                aria-label="橡皮擦粗细"
                type="range"
                min={4}
                max={64}
                step={1}
                disabled={disabled}
                value={brushSize}
                onChange={(event) =>
                  onBrushSizeChange(Number(event.target.value))
                }
              />
            </label>
          )}

          {tool === 'stamp' && (
            <>
              <section className="stamp-gallery" aria-label="青花纹样库">
                <div className="stamp-gallery-heading">
                  <h3>青花纹样</h3>
                  <button
                    type="button"
                    className="quiet"
                    disabled={disabled}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    导入图案
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    aria-label="导入图案图片"
                    disabled={disabled}
                    hidden
                    onChange={handleImageUpload}
                  />
                </div>
                <div
                  className="stamp-gallery-track"
                  role="group"
                  aria-label="可横向选择的青花纹样"
                >
                  {STAMP_ASSETS.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className="stamp-gallery-card"
                      aria-label={asset.name}
                      aria-pressed={stampAssetId === asset.id}
                      title={asset.description}
                      disabled={disabled}
                      onClick={() => onStampAssetChange(asset.id)}
                    >
                      <StampPreview
                        assetId={asset.id}
                        color={color}
                        maskUrl={asset.maskUrl}
                      />
                      <span>{asset.name}</span>
                    </button>
                  ))}
                  {customStampId && (
                    <button
                      type="button"
                      className="stamp-gallery-card"
                      aria-label={importedImage?.name ?? '导入图样'}
                      aria-pressed={stampAssetId === customStampId}
                      disabled={disabled}
                      onClick={() => onStampAssetChange(customStampId)}
                    >
                      <StampPreview
                        assetId={customStampId}
                        customPaths={contourPaths}
                        color={color}
                      />
                      <span>{importedImage?.name ?? '导入图样'}</span>
                    </button>
                  )}
                </div>
                {importedImage && (
                  <div className="imported-pattern-controls">
                    <span>{importedImage.name} · 轮廓预览已加入纹样库</span>
                    <div role="group" aria-label="轮廓精细度">
                      {CONTOUR_DETAILS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="chip-btn"
                          aria-pressed={contourDetail === item.id}
                          disabled={disabled}
                          onClick={() => updateContour(item.id, contourInvert)}
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
                          updateContour(contourDetail, !contourInvert)
                        }
                      >
                        反相
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <section
                className="stamp-symmetry"
                role="group"
                aria-label="非遗对称工艺"
              >
                <h3>非遗对称工艺</h3>
                <div
                  className="stamp-symmetry-options"
                  role="group"
                  aria-label="印章对称工艺"
                >
                  {SYMMETRY_OPTIONS.map((option) => (
                    <button
                      key={option.count}
                      type="button"
                      aria-label={`对称工艺：${option.name}`}
                      aria-pressed={symmetry === option.count}
                      disabled={disabled}
                      onClick={() => onSymmetryChange(option.count)}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </section>
              <label className="range-control">
                印章缩放{' '}
                <output aria-hidden="true">{stampScale.toFixed(2)}×</output>
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
              </label>
              <label className="range-control">
                印章旋转 <output aria-hidden="true">{rotationDegrees}°</output>
                <input
                  aria-label="印章旋转"
                  type="range"
                  min={(STAMP_ROTATION_RANGE.min * 180) / Math.PI}
                  max={(STAMP_ROTATION_RANGE.max * 180) / Math.PI}
                  step={1}
                  disabled={disabled}
                  value={rotationDegrees}
                  onChange={(event) =>
                    onStampRotationChange(
                      (Number(event.target.value) * Math.PI) / 180,
                    )
                  }
                />
              </label>
              <p className="muted">选中纹样后，在器身上点击即可落印。</p>
            </>
          )}

          {tool === 'rotary' && (
            <section className="rotary-patterns" aria-label="旋坯环绘纹样">
              <h3>选择纹样与尺寸，将毛笔悬停到器身预览</h3>
              <div className="rotary-pattern-grid">
                {ROTARY_PATTERNS.map((pattern) => (
                  <button
                    key={pattern.id}
                    type="button"
                    className="rotary-pattern-card"
                    aria-pressed={rotaryPattern === pattern.id}
                    disabled={disabled}
                    title={pattern.subtitle}
                    onClick={() => onRotaryPatternChange(pattern.id)}
                  >
                    {pattern.shape === 'stamp' && pattern.assetId ? (
                      <StampPreview assetId={pattern.assetId} color={color} />
                    ) : (
                      <RotaryLinePreview shape={pattern.shape} />
                    )}
                    <span>{pattern.name}</span>
                    <small>{pattern.subtitle}</small>
                  </button>
                ))}
              </div>
              <label className="range-control">
                纹样尺寸{' '}
                <output aria-hidden="true">
                  {rotaryPatternSize.toFixed(1)} cm
                </output>
                <input
                  aria-label="旋坯纹样尺寸"
                  type="range"
                  min={ROTARY_PATTERN_SIZE_RANGE.min}
                  max={ROTARY_PATTERN_SIZE_RANGE.max}
                  step={ROTARY_PATTERN_SIZE_RANGE.step}
                  disabled={disabled}
                  value={rotaryPatternSize}
                  onChange={(event) =>
                    onRotaryPatternSizeChange(Number(event.target.value))
                  }
                />
              </label>
              <p className="muted">
                根据当前器身周长计算整圈数量并自动均分，点击毛笔所在位置落下纹样。
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
