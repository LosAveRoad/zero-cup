export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;

const SHOT_MS = 3100;
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

const SHOTS: { from: FilmPose; to: FilmPose; verse: string }[] = [
  {
    from: [-0.32, 0.14, 6.9, 1.18],
    to: [0.18, 0.12, 6.45, 1.23],
    verse: '一捧泥成案上春',
  },
  {
    from: [0.5, 0.23, 3.95, 1.61],
    to: [0.96, 0.3, 3.55, 1.83],
    verse: '一寸釉光藏远山',
  },
  {
    from: [-0.67, 0.52, 6.25, 1.23],
    to: [-0.07, 0.23, 7.0, 1.18],
    verse: '静看清影落瓷肩',
  },
];

const OUTRO_START = SHOTS.length * SHOT_MS;
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

function drawOutro(ctx: CanvasRenderingContext2D, elapsed: number) {
  const center = FILM_WIDTH / 2;
  const light = ctx.createRadialGradient(center, 310, 25, center, 310, 480);
  light.addColorStop(0, '#294450');
  light.addColorStop(1, INK);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  ctx.save();
  ctx.globalAlpha = ease(elapsed / 440);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  ctx.restore();

  ctx.save();
  ctx.translate(center, 262);
  const reveal = ease(elapsed / 760);
  ctx.strokeStyle = '#c5a978';
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.6 * reveal;
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

  ctx.globalAlpha = reveal;
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
  ctx.globalAlpha = ease((elapsed - 300) / 620);
  ctx.fillStyle = IVORY;
  ctx.textAlign = 'center';
  text(ctx, '瓷器物语', center, 447, 56);
  ctx.fillStyle = '#c5a978';
  text(ctx, 'P O R C E L A I N   T A L E S', center, 485, 15, 'sans-serif');

  const seal = ease((elapsed - 740) / 340);
  ctx.globalAlpha = seal;
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

/** The graphics and the live WebGL shot go into the same frame before encoding. */
export function drawFilmFrame(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  name: string,
  renderShot: (pose: FilmPose) => HTMLCanvasElement,
) {
  if (elapsed >= OUTRO_START) {
    drawOutro(ctx, elapsed - OUTRO_START);
    return;
  }

  const index = Math.floor(elapsed / SHOT_MS);
  const shot = SHOTS[index];
  const time = elapsed - index * SHOT_MS;
  const travel = ease(time / SHOT_MS);
  const [azimuth, elevation, distance, target] = shot.from.map(
    (value, axis) => value + (shot.to[axis] - value) * travel,
  );
  const source = renderShot([azimuth, elevation, distance, target]);
  ctx.drawImage(source, 0, 0, FILM_WIDTH, FILM_HEIGHT);

  const shade = ctx.createLinearGradient(0, 0, 0, FILM_HEIGHT);
  shade.addColorStop(0, 'rgba(9, 18, 26, 0.5)');
  shade.addColorStop(0.27, 'rgba(9, 18, 26, 0)');
  shade.addColorStop(0.67, 'rgba(9, 18, 26, 0)');
  shade.addColorStop(1, 'rgba(9, 18, 26, 0.84)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);

  ctx.save();
  ctx.fillStyle = IVORY;
  ctx.globalAlpha = ease((time - 240) / 400);
  if (index === 0) {
    ctx.textAlign = 'left';
    text(ctx, '瓷 器 物 语', 52, 63, 20);
    ctx.fillRect(52, 80, 28, 1);
    text(ctx, name, 52, 114, 30);
  }
  ctx.textAlign = 'center';
  text(ctx, shot.verse, FILM_WIDTH / 2, 650, 36);
  ctx.fillStyle = '#c5a978';
  ctx.fillRect(FILM_WIDTH / 2 - 20, 671, 40, 1);

  // Dip to ink conceals the cut between independent camera moves.
  ctx.globalAlpha = 1 - ease(Math.min(time, SHOT_MS - time) / 380);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  ctx.restore();
}
