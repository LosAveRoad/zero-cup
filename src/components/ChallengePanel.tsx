import type { JSX } from 'react';
import {
  scoreLabel,
  scoreStars,
  type ChallengeDefinition,
} from '../core/challenges/challenges';

export interface ChallengePanelProps {
  challenge: ChallengeDefinition | undefined;
  /** current match score, 0-100 */
  score?: number;
}

/** Layout of the inline silhouette preview. */
const PREVIEW_WIDTH = 132;
const PREVIEW_HEIGHT = 168;
const PREVIEW_AXIS_X = PREVIEW_WIDTH / 2;
const PREVIEW_TOP = 12;
const PREVIEW_BOTTOM = PREVIEW_HEIGHT - 12;
/** the widest legal radius (0.9) maps to this many pixels */
const PREVIEW_RADIUS_SCALE = 58;

type Point = readonly [number, number];

function previewY(height: number): number {
  return PREVIEW_BOTTOM - height * (PREVIEW_BOTTOM - PREVIEW_TOP);
}

function previewX(radius: number, side: 1 | -1): number {
  return PREVIEW_AXIS_X + side * radius * PREVIEW_RADIUS_SCALE;
}

function format(point: Point): string {
  return `${point[0].toFixed(2)} ${point[1].toFixed(2)}`;
}

/**
 * Cubic Bézier segments through the given points (Catmull-Rom converted to
 * Béziers), so the preview reads as a smooth silhouette instead of a polyline.
 */
function curveSegments(points: readonly Point[]): string {
  let path = '';
  for (let i = 0; i < points.length - 1; i++) {
    const previous = points[Math.max(i - 1, 0)];
    const current = points[i];
    const next = points[i + 1];
    const after = points[Math.min(i + 2, points.length - 1)];
    const c1: Point = [
      current[0] + (next[0] - previous[0]) / 6,
      current[1] + (next[1] - previous[1]) / 6,
    ];
    const c2: Point = [
      next[0] - (after[0] - current[0]) / 6,
      next[1] - (after[1] - current[1]) / 6,
    ];
    path += ` C ${format(c1)} ${format(c2)} ${format(next)}`;
  }
  return path;
}

/** Closed silhouette of a target outline, mirrored around the axis. */
function silhouettePath(profile: ChallengeDefinition['profile']): string {
  const right = profile.map((point): Point => [
    previewX(point.radius, 1),
    previewY(point.height),
  ]);
  const left = profile.map((point): Point => [
    previewX(point.radius, -1),
    previewY(point.height),
  ]);
  const top = left[left.length - 1];
  // right wall upwards, across the rim, left wall downwards, closed at the foot
  return `M ${format(right[0])}${curveSegments(right)} L ${format(
    top,
  )}${curveSegments([...left].reverse())} Z`;
}

function Stars({ count }: { count: number }): JSX.Element {
  return (
    <span role="img" aria-label={`评分 ${count} 星`}>
      {'★'.repeat(count)}
      {'☆'.repeat(3 - count)}
    </span>
  );
}

/**
 * Shows the chosen vessel goal and how well the current outline matches it.
 */
export function ChallengePanel({
  challenge,
  score,
}: ChallengePanelProps): JSX.Element {
  if (!challenge) return <></>;
  const currentScore = challenge ? score : undefined;
  return (
    <div
      className="challenge-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {challenge && (
        <div
          className="challenge-detail"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <p>{challenge.description}</p>
          <p className="muted">{challenge.hint}</p>
          <svg
            className="challenge-preview"
            role="img"
            aria-label={`${challenge.name} 目标剪影`}
            viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            style={{
              background: '#fff',
              border: '1px solid #d7d9ce',
              borderRadius: 8,
              alignSelf: 'center',
            }}
          >
            <line
              x1={PREVIEW_AXIS_X}
              y1={PREVIEW_TOP - 4}
              x2={PREVIEW_AXIS_X}
              y2={PREVIEW_BOTTOM + 4}
              stroke="#d2d7d2"
              strokeDasharray="4 4"
            />
            <path
              d={silhouettePath(challenge.profile)}
              fill="#e7eef4"
              stroke="#254f70"
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          </svg>
          {currentScore !== undefined ? (
            <p className="challenge-score" style={{ margin: 0 }}>
              吻合度 {currentScore}% · {scoreLabel(currentScore)}{' '}
              <Stars count={scoreStars(currentScore)} />
            </p>
          ) : (
            <p className="challenge-score muted" style={{ margin: 0 }}>
              尚未评分
            </p>
          )}
        </div>
      )}
    </div>
  );
}
