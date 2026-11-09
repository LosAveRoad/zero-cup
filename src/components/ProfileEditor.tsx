import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { ProfileControlPoint } from '../types/artwork';
import {
  PROFILE_LIMITS,
  computeVesselMetrics,
  createProfile,
  createTemplateProfile,
  matchTemplateId,
  moveControlPoint,
  sampleProfile,
  type ProfileTemplateId,
} from '../core/geometry/profile';

export interface ProfileEditorProps {
  points: ProfileControlPoint[];
  onChange: (points: ProfileControlPoint[]) => void;
  templates?: ProfileTemplateId[];
  targetPoints?: ProfileControlPoint[];
  onReset?: () => void;
  disabled?: boolean;
}

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 420;
const PADDING = 26;
/** The vertical radius axis (radius 0) sits in the middle of the canvas. */
const AXIS_X = VIEW_WIDTH / 2;
const RADIUS_SCALE = (VIEW_WIDTH / 2 - PADDING) / PROFILE_LIMITS.maxRadius;
const TOP_Y = PADDING + 4;
const BOTTOM_Y = VIEW_HEIGHT - PADDING - 18;
const HEIGHT_SCALE = BOTTOM_Y - TOP_Y;

const ALL_TEMPLATES: ProfileTemplateId[] = [
  'bottle',
  'meiping',
  'cup',
  'melon',
];

const TEMPLATE_LABELS: Record<ProfileTemplateId, string> = {
  bottle: '玉壶春瓶',
  meiping: '梅瓶',
  cup: '压手杯',
  melon: '甜瓜瓶',
};

interface DragState {
  id: string;
  pointerId: number;
  start: ProfileControlPoint[];
}

/** Canvas position of a control point; the radius grows to the right. */
function toCanvas(radius: number, height: number) {
  return {
    x: AXIS_X + radius * RADIUS_SCALE,
    y: BOTTOM_Y - height * HEIGHT_SCALE,
  };
}

/** Radius and height of a canvas position, unclamped on purpose. */
function toProfile(x: number, y: number) {
  return {
    radius: (x - AXIS_X) / RADIUS_SCALE,
    height: (BOTTOM_Y - y) / HEIGHT_SCALE,
  };
}

/** Smooth outline of the vessel, falling back to the raw points when unusable. */
function outlinePoints(points: ProfileControlPoint[]) {
  try {
    return sampleProfile(points, 64);
  } catch {
    return points.map((p) => ({ radius: p.radius, height: p.height }));
  }
}

function pathFor(
  samples: { radius: number; height: number }[],
  mirrored: boolean,
): string {
  return samples
    .map((sample, i) => {
      const { x, y } = toCanvas(sample.radius, sample.height);
      const px = mirrored ? AXIS_X - (x - AXIS_X) : x;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

/**
 * Self contained 2D outline editor.
 *
 * The canvas shows the vessel profile next to its mirrored silhouette: the
 * vertical radius axis is the axis of revolution, so the dashed mirror on the
 * left makes the lathe silhouette read as symmetric. Control points can be
 * dragged with the mouse or nudged with the arrow keys. The component never
 * touches Three.js or the storage layer.
 */
export function ProfileEditor({
  points,
  onChange,
  templates = ALL_TEMPLATES,
  targetPoints,
  onReset,
  disabled = false,
}: ProfileEditorProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointsRef = useRef<ProfileControlPoint[]>(points);
  const onChangeRef = useRef(onChange);
  const [dragging, setDragging] = useState<string | null>(null);
  const template = useMemo(() => matchTemplateId(points), [points]);

  useEffect(() => {
    pointsRef.current = points;
    onChangeRef.current = onChange;
  }, [points, onChange]);

  const outline = useMemo(() => outlinePoints(points), [points]);
  const metrics = useMemo(() => computeVesselMetrics(points), [points]);
  const outlinePath = useMemo(() => pathFor(outline, false), [outline]);
  const mirrorPath = useMemo(() => pathFor(outline, true), [outline]);
  const silhouetteFillPath = useMemo(() => {
    if (outline.length === 0) return '';
    const right = outline
      .map((s, i) => {
        const { x, y } = toCanvas(s.radius, s.height);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    const left = [...outline]
      .reverse()
      .map((s) => {
        const { x, y } = toCanvas(s.radius, s.height);
        const mx = AXIS_X - (x - AXIS_X);
        return `L${mx.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    return `${right} ${left} Z`;
  }, [outline]);
  const targetOutline = useMemo(
    () => (targetPoints ? outlinePoints(targetPoints) : null),
    [targetPoints],
  );
  const targetRightPath = useMemo(
    () => (targetOutline ? pathFor(targetOutline, false) : ''),
    [targetOutline],
  );
  const targetLeftPath = useMemo(
    () => (targetOutline ? pathFor(targetOutline, true) : ''),
    [targetOutline],
  );

  // Window level listeners keep the drag alive when the pointer leaves the
  // canvas and make sure a cancelled gesture can never lock the editor.
  useEffect(() => {
    /** Canvas coordinates of a pointer position, also outside the canvas. */
    function toSvgPoint(event: { clientX: number; clientY: number }) {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const det = ctm.a * ctm.d - ctm.b * ctm.c;
        if (det) {
          const dx = event.clientX - ctm.e;
          const dy = event.clientY - ctm.f;
          return {
            x: (ctm.d * dx - ctm.c * dy) / det,
            y: (-ctm.b * dx + ctm.a * dy) / det,
          };
        }
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const scale = Math.min(
        rect.width / VIEW_WIDTH,
        rect.height / VIEW_HEIGHT,
      );
      const offsetX = (rect.width - VIEW_WIDTH * scale) / 2;
      const offsetY = (rect.height - VIEW_HEIGHT * scale) / 2;
      return {
        x: (event.clientX - rect.left - offsetX) / scale,
        y: (event.clientY - rect.top - offsetY) / scale,
      };
    }

    function applyDrag(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const position = toSvgPoint(event);
      if (!position) return;
      const { radius, height } = toProfile(position.x, position.y);
      const next = moveControlPoint(pointsRef.current, drag.id, {
        radius,
        height,
      });
      pointsRef.current = next;
      onChangeRef.current(next);
    }

    function endDrag(event: PointerEvent) {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(null);
    }

    /** Cancels the drag and restores the outline as it was before it started. */
    function cancelDrag() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragging(null);
      onChangeRef.current(drag.start);
    }

    const onMove = (event: PointerEvent) => applyDrag(event);
    const onUp = (event: PointerEvent) => endDrag(event);
    const onCancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      cancelDrag();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  function startDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    point: ProfileControlPoint,
  ) {
    if (disabled) return;
    event.preventDefault();
    dragRef.current = {
      id: point.id,
      pointerId: event.pointerId,
      start: pointsRef.current.map((p) => ({ ...p })),
    };
    setDragging(point.id);
  }

  function nudge(point: ProfileControlPoint, event: ReactKeyboardEvent) {
    if (disabled) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    let radius = point.radius;
    let height = point.height;
    if (event.key === 'ArrowLeft') radius -= step;
    else if (event.key === 'ArrowRight') radius += step;
    else if (event.key === 'ArrowUp') height += step;
    else if (event.key === 'ArrowDown') height -= step;
    else return;
    event.preventDefault();
    onChange(moveControlPoint(points, point.id, { radius, height }));
  }

  return (
    <div className="profile-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="group"
        aria-label="器型轮廓编辑器"
        style={{ width: '100%', maxWidth: 360, touchAction: 'none' }}
      >
        <defs>
          <linearGradient id="vesselClayFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d9e6f2" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#eef3f7" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#c4d8ea" stopOpacity="0.46" />
          </linearGradient>
        </defs>
        <rect
          x={PADDING / 2}
          y={PADDING / 2}
          width={VIEW_WIDTH - PADDING}
          height={VIEW_HEIGHT - PADDING}
          rx={8}
          fill="#f7f4ec"
          stroke="#d8d2c4"
        />
        {silhouetteFillPath && (
          <path
            d={silhouetteFillPath}
            fill="url(#vesselClayFill)"
            pointerEvents="none"
          />
        )}
        {/* Belly maximum diameter callout line */}
        {(() => {
          const bellyPos = toCanvas(metrics.bellyRadius, metrics.bellyHeight);
          const leftBellyX = AXIS_X - (bellyPos.x - AXIS_X);
          return (
            <g aria-hidden="true" pointerEvents="none" opacity="0.72">
              <line
                x1={leftBellyX}
                y1={bellyPos.y}
                x2={bellyPos.x}
                y2={bellyPos.y}
                stroke="#7a9bb8"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <text
                x={PADDING + 6}
                y={Math.max(TOP_Y + 24, bellyPos.y - 4)}
                fontSize="9.5"
                fill="#4a6f8f"
              >
                最大腹径 {(metrics.bellyRadius * 20).toFixed(1)}cm
              </text>
            </g>
          );
        })()}
        {/* vertical radius axis: axis of revolution, height 0 at the bottom */}
        <line
          x1={AXIS_X}
          y1={TOP_Y}
          x2={AXIS_X}
          y2={BOTTOM_Y}
          stroke="#b6ad9c"
          strokeDasharray="4 4"
        />
        {/* horizontal radius axis: radius 0 .. 0.9 */}
        <line
          x1={AXIS_X}
          y1={BOTTOM_Y}
          x2={AXIS_X + RADIUS_SCALE * PROFILE_LIMITS.maxRadius}
          y2={BOTTOM_Y}
          stroke="#b6ad9c"
        />
        <text x={AXIS_X + 6} y={TOP_Y + 10} fontSize="10" fill="#8a8172">
          高度 1
        </text>
        <text x={AXIS_X + 6} y={BOTTOM_Y - 4} fontSize="10" fill="#8a8172">
          高度 0
        </text>
        <text
          x={AXIS_X + RADIUS_SCALE * PROFILE_LIMITS.maxRadius}
          y={BOTTOM_Y + 14}
          fontSize="10"
          textAnchor="end"
          fill="#8a8172"
        >
          半径 0.9
        </text>
        {targetOutline && (
          <g aria-hidden="true">
            <path
              d={targetLeftPath}
              fill="none"
              stroke="#c98448"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              opacity="0.55"
            />
            <path
              d={targetRightPath}
              fill="none"
              stroke="#c98448"
              strokeWidth="2"
              strokeDasharray="6 3"
              opacity="0.85"
              data-testid="profile-target-reference"
            />
            <text x={PADDING + 6} y={TOP_Y + 10} fontSize="10" fill="#b06b30">
              虚线：挑战目标参考
            </text>
          </g>
        )}
        {/* mirrored silhouette: the symmetry reference of the lathe */}
        <path
          d={mirrorPath}
          fill="none"
          stroke="#9fb7c9"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          data-testid="profile-mirror"
        />
        <path
          d={outlinePath}
          fill="none"
          stroke="#2f6ea8"
          strokeWidth="2"
          data-testid="profile-outline"
        />
        {points.map((point, index) => {
          const { x, y } = toCanvas(point.radius, point.height);
          return (
            <circle
              key={point.id}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={`控制点 ${index + 1}`}
              aria-orientation="horizontal"
              aria-valuemin={PROFILE_LIMITS.minRadius}
              aria-valuemax={PROFILE_LIMITS.maxRadius}
              aria-valuenow={point.radius}
              aria-valuetext={`高度 ${point.height.toFixed(2)}，半径 ${point.radius.toFixed(2)}`}
              aria-disabled={disabled}
              data-testid={`profile-point-${index}`}
              data-height={point.height}
              data-radius={point.radius}
              cx={x}
              cy={y}
              r={dragging === point.id ? 7 : 5.5}
              fill={dragging === point.id ? '#2f6ea8' : '#ffffff'}
              stroke="#2f6ea8"
              strokeWidth="2"
              style={{ cursor: disabled ? 'not-allowed' : 'grab' }}
              onPointerDown={(event) => startDrag(event, point)}
              onKeyDown={(event) => nudge(point, event)}
            />
          );
        })}
      </svg>
      <div className="vessel-metrics-grid" aria-label="器物造物参数">
        <div className="metric-chip">
          <span className="metric-label">预估容积</span>
          <strong>{metrics.volumeMl} mL</strong>
        </div>
        <div className="metric-chip">
          <span className="metric-label">器身修长比</span>
          <strong>{metrics.slenderness.toFixed(2)}</strong>
        </div>
        <div className="metric-chip">
          <span className="metric-label">重心稳度</span>
          <strong>{metrics.stabilityScore} 分</strong>
        </div>
      </div>
      <div className="profile-editor-controls">
        <label>
          模板
          <select
            aria-label="器型模板"
            value={template}
            disabled={disabled}
            onChange={(event) => {
              const kind = event.target.value as ProfileTemplateId | '';
              if (kind) onChange(createTemplateProfile(kind));
            }}
          >
            <option value="">选择模板</option>
            {templates.map((kind) => (
              <option key={kind} value={kind}>
                {TEMPLATE_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (onReset) onReset();
            else onChange(createProfile());
          }}
        >
          重置轮廓
        </button>
      </div>
    </div>
  );
}
