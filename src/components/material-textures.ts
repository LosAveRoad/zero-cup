import * as THREE from 'three';

export function createWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#a98154');
  base.addColorStop(0.46, '#89633f');
  base.addColorStop(1, '#705033');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 48; i++) {
    const y = (i / 48) * canvas.height;
    const drift = Math.sin(i * 1.73) * 7;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      canvas.width * 0.32,
      y + drift,
      canvas.width * 0.68,
      y - drift * 0.7,
      canvas.width,
      y + Math.cos(i * 1.19) * 3,
    );
    ctx.strokeStyle =
      i % 4 === 0 ? 'rgba(54, 34, 20, 0.24)' : 'rgba(241, 211, 161, 0.12)';
    ctx.lineWidth = i % 4 === 0 ? 1.4 : 0.7;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return { canvas, texture };
}
