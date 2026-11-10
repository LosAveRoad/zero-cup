import type { ExhibitionSceneId } from '../types/artwork';

export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;

const VERSE_MS = 3100;
const DISSOLVE_MS = 720;
const OUTRO_DISSOLVE_MS = 560;
const OUTRO_MS = 2400;
const INK = '#111f2a';
const IVORY = '#faf1dd';
const SERIF = '"Songti SC", "Noto Serif CJK SC", "SimSun", serif';

type FilmPose = [
  azimuth: number,
  elevation: number,
  distance: number,
  target: number,
];

const VERSES = ['一捧泥成案上春', '一寸釉光藏远山', '静看清影落瓷肩'];
const THEMES = ['ink', 'lattice', 'moon'] as const;
type FilmScenes = readonly [
  ExhibitionSceneId,
  ExhibitionSceneId,
  ExhibitionSceneId,
];

export function filmScenesFor(
  start: ExhibitionSceneId,
  multiple: boolean,
): FilmScenes {
  if (!multiple) return [start, start, start];
  if (start === 'lattice') return ['lattice', 'moon', 'ink'];
  if (start === 'moon') return ['moon', 'ink', 'lattice'];
  return THEMES;
}

const OUTRO_START = VERSES.length * VERSE_MS;
export const FILM_DURATION_MS = OUTRO_START + OUTRO_MS;

function ease(value: number): number {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  family = SERIF,
) {
  ctx.font = `${size}px ${family}`;
  ctx.fillText(value, x, y, 540);
}

function drawOutro(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  opacity: number,
) {
  const center = FILM_WIDTH / 2;
  const light = ctx.createRadialGradient(center, 310, 25, center, 310, 480);
  light.addColorStop(0, '#294450');
  light.addColorStop(1, INK);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  ctx.globalAlpha = opacity * ease(elapsed / 440);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  ctx.restore();

  ctx.save();
  ctx.translate(center, 262);
  const reveal = ease(elapsed / 760);
  ctx.strokeStyle = '#c5a978';
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = opacity * 0.6 * reveal;
  for (const [radius, offset] of [
    [94, 0],
    [109, Math.PI],
  ]) {
    ctx.beginPath();
    ctx.arc(
      0,
      0,
      radius,
      offset - Math.PI / 2,
      offset - Math.PI / 2 + reveal * Math.PI * 1.94,
    );
    ctx.stroke();
  }

  ctx.globalAlpha = opacity * reveal;
  ctx.strokeStyle = IVORY;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-18, -53);
  ctx.bezierCurveTo(-17, -34, -13, -28, -33, -7);
  ctx.bezierCurveTo(-58, 17, -42, 48, -24, 58);
  ctx.lineTo(24, 58);
  ctx.bezierCurveTo(42, 48, 58, 17, 33, -7);
  ctx.bezierCurveTo(13, -28, 17, -34, 18, -53);
  ctx.ellipse(0, -53, 18, 4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = opacity * ease((elapsed - 300) / 620);
  ctx.fillStyle = IVORY;
  ctx.textAlign = 'center';
  text(ctx, '瓷器物语', center, 447, 56);
  ctx.fillStyle = '#c5a978';
  text(ctx, 'P O R C E L A I N   T A L E S', center, 485, 15, 'sans-serif');

  const seal = ease((elapsed - 740) / 340);
  ctx.globalAlpha = opacity * seal;
  ctx.translate(center, 552 - (1 - seal) * 26);
  const scale = 1 + (1 - seal) * 0.34;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#b6493d';
  ctx.fillRect(-25, -25, 50, 50);
  ctx.strokeStyle = '#ebc7a3';
  ctx.lineWidth = 1;
  ctx.strokeRect(-21, -21, 42, 42);
  ctx.fillStyle = IVORY;
  text(ctx, '瓷', 0, 11, 31);
  ctx.restore();
}

/** Every backdrop is rendered from the same moving camera, including during a dissolve. */
export function drawFilmFrame(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  name: string,
  scenes: FilmScenes,
  renderShot: (pose: FilmPose, scene: ExhibitionSceneId) => HTMLCanvasElement,
) {
  const outroElapsed = elapsed - OUTRO_START;
  if (outroElapsed >= OUTRO_DISSOLVE_MS) {
    drawOutro(ctx, outroElapsed, 1);
    return;
  }

  const progress = Math.min(1, elapsed / OUTRO_START);
  const closeup = Math.sin(Math.PI * progress) ** 2;
  const pose: FilmPose = [
    -0.42 + 1.06 * ease(progress),
    0.11 + 0.31 * ease((progress - 0.43) / 0.57),
    6.85 - 2.72 * closeup,
    1.19 + 0.44 * closeup,
  ];

  const halfDissolve = DISSOLVE_MS / 2;
  const incoming = Math.min(
    Math.floor((elapsed + halfDissolve) / VERSE_MS),
    VERSES.length - 1,
  );
  const outgoing = Math.max(0, incoming - 1);
  const mix =
    incoming === 0
      ? 1
      : ease((elapsed - incoming * VERSE_MS + halfDissolve) / DISSOLVE_MS);
  const blendScenes = mix < 1 && scenes[outgoing] !== scenes[incoming];
  const background = blendScenes ? scenes[outgoing] : scenes[incoming];

  ctx.drawImage(renderShot(pose, background), 0, 0, FILM_WIDTH, FILM_HEIGHT);
  if (blendScenes && mix > 0) {
    ctx.save();
    ctx.globalAlpha = mix;
    ctx.drawImage(
      renderShot(pose, scenes[incoming]),
      0,
      0,
      FILM_WIDTH,
      FILM_HEIGHT,
    );
    ctx.restore();
  }

  const shade = ctx.createLinearGradient(0, 0, 0, FILM_HEIGHT);
  shade.addColorStop(0, 'rgba(9, 18, 26, 0.5)');
  shade.addColorStop(0.27, 'rgba(9, 18, 26, 0)');
  shade.addColorStop(0.67, 'rgba(9, 18, 26, 0)');
  shade.addColorStop(1, 'rgba(9, 18, 26, 0.84)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);

  ctx.save();
  ctx.fillStyle = IVORY;
  if (incoming === 0) {
    ctx.globalAlpha = ease(elapsed / 380) * (1 - ease((elapsed - 2000) / 440));
    ctx.textAlign = 'left';
    text(ctx, '瓷 器 物 语', 52, 63, 20);
    ctx.fillRect(52, 80, 28, 1);
    text(ctx, name, 52, 114, 30);
  }

  const verse = mix < 0.5 ? VERSES[outgoing] : VERSES[incoming];
  ctx.globalAlpha = ease(elapsed / 380) * Math.abs(2 * mix - 1);
  ctx.textAlign = 'center';
  text(ctx, verse, FILM_WIDTH / 2, 650, 36);
  ctx.fillStyle = '#c5a978';
  ctx.fillRect(FILM_WIDTH / 2 - 20, 671, 40, 1);
  ctx.restore();

  if (outroElapsed >= 0) {
    drawOutro(ctx, outroElapsed, ease(outroElapsed / OUTRO_DISSOLVE_MS));
  }
}
