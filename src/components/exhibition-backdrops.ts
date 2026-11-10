const WIDTH = 1024;
const HEIGHT = 768;

function sky(
  ctx: CanvasRenderingContext2D,
  top: string,
  middle: string,
  bottom: string,
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.54, middle);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string | CanvasGradient,
) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function ridge(
  ctx: CanvasRenderingContext2D,
  peaks: readonly number[],
  color: string,
) {
  const stride = WIDTH / (peaks.length - 1);
  ctx.beginPath();
  ctx.moveTo(0, peaks[0]);
  for (let i = 1; i < peaks.length; i++) {
    const x = i * stride;
    ctx.bezierCurveTo(
      x - stride * 0.62,
      peaks[i - 1],
      x - stride * 0.27,
      peaks[i],
      x,
      peaks[i],
    );
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawInkBackdrop(ctx: CanvasRenderingContext2D) {
  sky(ctx, '#c9d7d3', '#f3eddf', '#adbab0');
  glow(ctx, 530, 420, 360, 'rgba(255, 249, 225, 0.75)');
  glow(ctx, 688, 321, 96, 'rgba(232, 146, 100, 0.24)');
  disc(ctx, 688, 321, 29, '#d9a482');

  ridge(ctx, [503, 418, 461, 358, 435, 506, 470, 399, 503], '#b0bdb6');
  ridge(ctx, [566, 458, 481, 511, 545, 517, 447, 484, 566], '#96aba3');

  const mist = ctx.createLinearGradient(0, 456, 0, 620);
  mist.addColorStop(0, 'transparent');
  mist.addColorStop(0.48, '#e8e7d7');
  mist.addColorStop(1, 'transparent');
  ctx.fillStyle = mist;
  ctx.fillRect(0, 456, WIDTH, 164);

  ridge(ctx, [585, 527, 558, 588, 609, 594, 573, 514, 585], '#8c9f95');
}

export function drawLatticeBackdrop(ctx: CanvasRenderingContext2D) {
  sky(ctx, '#231812', '#42291d', '#241a16');
  glow(ctx, 512, 395, 400, '#98623b');
  glow(ctx, 512, 346, 195, 'rgba(239, 176, 96, 0.35)');

  // A recessed centre panel framed by repeating timber lattice.
  ctx.fillStyle = '#2a1a14';
  ctx.fillRect(0, 565, WIDTH, 12);
  ctx.fillRect(0, 592, WIDTH, 21);
  ctx.fillRect(0, 231, WIDTH, 10);
  ctx.fillStyle = '#ad784c';
  ctx.fillRect(0, 239, WIDTH, 2);
  ctx.fillRect(0, 566, WIDTH, 2);

  for (const [start, end] of [
    [0, 390],
    [634, WIDTH],
  ]) {
    for (let x = start; x < end; x += 21) {
      ctx.fillStyle = '#38231b';
      ctx.fillRect(x, 0, 8, HEIGHT);
      ctx.fillStyle = '#92613e';
      ctx.fillRect(x, 0, 1.5, HEIGHT);
      ctx.fillStyle = 'rgba(16, 10, 9, 0.23)';
      ctx.fillRect(x + 8, 0, 4, HEIGHT);
    }
    for (let y = 260; y < 550; y += 44) {
      ctx.fillStyle = '#42291e';
      ctx.fillRect(start, y, end - start, 4);
      ctx.fillStyle = '#936440';
      ctx.fillRect(start, y, end - start, 1);
    }
  }

  for (const x of [372, 634]) {
    ctx.fillStyle = '#21150f';
    ctx.fillRect(x, 0, 18, HEIGHT);
    ctx.fillStyle = '#9f6a43';
    ctx.fillRect(x + 15, 0, 2, HEIGHT);
  }
}

export function drawMoonBackdrop(ctx: CanvasRenderingContext2D) {
  sky(ctx, '#0b1522', '#1a2938', '#101820');
  glow(ctx, 512, 430, 305, 'rgba(98, 130, 150, 0.38)');

  const x = 512;
  const y = 438;
  const radius = 195;
  const skyThroughGate = ctx.createLinearGradient(0, y - radius, 0, y + radius);
  skyThroughGate.addColorStop(0, '#233d56');
  skyThroughGate.addColorStop(0.57, '#476776');
  skyThroughGate.addColorStop(1, '#7b999c');

  disc(ctx, x, y, radius + 11, '#19242d');
  disc(ctx, x, y, radius + 7, '#6a858e');
  disc(ctx, x, y, radius + 3, '#304956');
  disc(ctx, x, y, radius, skyThroughGate);

  ctx.save();
  ctx.clip();
  glow(ctx, 617, 332, 83, 'rgba(211, 240, 236, 0.53)');
  disc(ctx, 617, 332, 27, '#dcecea');

  ridge(ctx, [542, 498, 512, 488, 501, 527, 502, 480, 542], '#415f71');
  ridge(ctx, [581, 544, 559, 516, 554, 567, 542, 514, 581], '#2b4657');
  ridge(ctx, [613, 595, 561, 581, 604, 574, 592, 563, 613], '#203645');
  ctx.restore();

  // The wall's masonry continues around the courtyard.
  ctx.strokeStyle = 'rgba(141, 169, 177, 0.14)';
  ctx.lineWidth = 1;
  for (let lineY = 272; lineY <= 656; lineY += 64) {
    const gap = Math.sqrt(Math.max(0, (radius + 13) ** 2 - (lineY - y) ** 2));
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(x - gap, lineY);
    ctx.moveTo(x + gap, lineY);
    ctx.lineTo(WIDTH, lineY);
    ctx.stroke();
  }
}

export function createBackdropCanvas(
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  draw(canvas.getContext('2d')!);
  return canvas;
}
