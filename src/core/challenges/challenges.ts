import type { ProfileControlPoint } from '../../types/artwork';

/** Ids of the three vessel-shape challenges shipped with the studio. */
export type ChallengeId = 'yuhuchun' | 'meiping' | 'yazhbei';

export interface ChallengeDefinition {
  id: ChallengeId;
  name: string;
  /** one short Chinese sentence describing the shape */
  description: string;
  /** a short Chinese shaping hint */
  hint: string;
  /** the target outline the player tries to match */
  profile: ProfileControlPoint[];
}

/** Mean radius error (in normalized radius units) that maps to a score of 0. */
const MATCH_TOLERANCE = 0.2;
/** Number of heights both outlines are compared at when the caller does not say. */
const DEFAULT_SAMPLES = 64;
/** Upper bound of the comparison sample count, keeps scoring cheap. */
const MAX_SAMPLES = 256;

/**
 * Heights shared by every target outline: 8 control points evenly spread over
 * the normalized height [0,1], so the gaps are 1/7 (>= 0.05) as required.
 */
const PROFILE_HEIGHTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i / 7);

function buildProfile(radii: number[]): ProfileControlPoint[] {
  return radii.map((radius, i) => ({
    id: `point-${i}`,
    height: PROFILE_HEIGHTS[i],
    radius,
  }));
}

/**
 * The three challenges of the PRD: 玉壶春瓶 / 梅瓶 / 压手杯.
 * The order matters: the panel renders the choices in this order.
 */
export const CHALLENGES: readonly ChallengeDefinition[] = [
  {
    id: 'yuhuchun',
    name: '玉壶春瓶',
    description: '撇口细颈、丰腹圈足的玉壶春瓶，青花瓷里的经典器型。',
    hint: '上端开口外撇，颈部收细，中部鼓腹饱满，下部收到圈足。',
    profile: buildProfile([0.22, 0.34, 0.52, 0.56, 0.4, 0.2, 0.17, 0.26]),
  },
  {
    id: 'meiping',
    name: '梅瓶',
    description: '小口丰肩、敛腹瘦底的梅瓶，肩线挺拔如美人肩。',
    hint: '口小肩宽，肩线以下快速收拢，底足窄瘦。',
    profile: buildProfile([0.2, 0.3, 0.42, 0.54, 0.62, 0.56, 0.26, 0.15]),
  },
  {
    id: 'yazhbei',
    name: '压手杯',
    description: '撇口鼓腹、小圈足的压手杯，杯形敦厚朴拙。',
    hint: '口沿外撇，腹壁自下而上渐宽，底部略收成小圈足。',
    profile: buildProfile([0.3, 0.4, 0.48, 0.54, 0.58, 0.62, 0.66, 0.7]),
  },
];

/** Find a challenge by id; unknown ids (and the free-form mode) give undefined. */
export function getChallenge(id: string): ChallengeDefinition | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

/**
 * Radius of an outline at a given normalized height, linearly interpolated
 * between the two surrounding control points. Heights outside the outline's
 * own range clamp to the first / last control point.
 */
function radiusAtHeight(points: ProfileControlPoint[], height: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (height <= first.height) return first.radius;
  if (height >= last.height) return last.radius;
  let i = 1;
  while (i < points.length - 1 && points[i].height < height) i += 1;
  const lower = points[i - 1];
  const upper = points[i];
  const span = upper.height - lower.height;
  const t = (height - lower.height) / span;
  return lower.radius + (upper.radius - lower.radius) * t;
}

function normalizeSamples(samples: number): number {
  if (!Number.isFinite(samples)) return DEFAULT_SAMPLES;
  return Math.min(MAX_SAMPLES, Math.max(2, Math.floor(samples)));
}

/**
 * 0-100 match between the user's outline and the target silhouette.
 * Both outlines are sampled at the same heights and compared radius by radius.
 *
 * The score is the mean absolute radius error remapped onto a percentage:
 * `score = 100 * (1 - meanError / MATCH_TOLERANCE)`, clamped to [0, 100] and
 * rounded to an integer. An identical outline scores 100; an outline that is
 * off by 0.2 in radius on average scores 0. The metric is symmetric and
 * deterministic: the same pair of outlines always yields the same score.
 */
export function silhouetteScore(
  user: ProfileControlPoint[],
  target: ProfileControlPoint[],
  samples: number = DEFAULT_SAMPLES,
): number {
  if (user.length === 0 || target.length === 0) return 0;
  const count = normalizeSamples(samples);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const height = i / (count - 1);
    total += Math.abs(
      radiusAtHeight(user, height) - radiusAtHeight(target, height),
    );
  }
  const meanError = total / count;
  const raw = (1 - meanError / MATCH_TOLERANCE) * 100;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Evaluation bands shared by scoreLabel and scoreStars, best band first.
 * A score belongs to the first band whose `min` it reaches.
 */
const SCORE_BANDS = [
  { min: 90, label: '形神兼备', stars: 3 },
  { min: 75, label: '风韵初具', stars: 2 },
  { min: 60, label: '形似而神未至', stars: 1 },
  { min: 0, label: '尚需打磨', stars: 0 },
] as const;

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

/** Index of the band a (already clamped) score falls into. */
function bandIndex(value: number): number {
  if (value >= SCORE_BANDS[0].min) return 0;
  if (value >= SCORE_BANDS[1].min) return 1;
  if (value >= SCORE_BANDS[2].min) return 2;
  return 3;
}

/**
 * A Chinese label for a score.
 * Bands: >=90 形神兼备, >=75 风韵初具, >=60 形似而神未至, <60 尚需打磨.
 */
export function scoreLabel(score: number): string {
  return SCORE_BANDS[bandIndex(clampScore(score))].label;
}

/**
 * 0-3 stars for a score.
 * Bands: >=90 gives 3 stars, >=75 gives 2, >=60 gives 1, below 60 gives 0.
 */
export function scoreStars(score: number): number {
  return SCORE_BANDS[bandIndex(clampScore(score))].stars;
}
