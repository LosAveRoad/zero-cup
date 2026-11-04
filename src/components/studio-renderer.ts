import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sampleProfile } from '../core/geometry/profile';
import { splitSegment, type Stroke } from '../core/painting/strokes';
import type { ProfileControlPoint, UVPoint } from '../types/artwork';

export interface StudioOptions {
  profile: ProfileControlPoint[];
  strokes: Stroke[];
  fired: boolean;
  painting: boolean;
  brushSize: number;
  color: string;
  onStroke: (stroke: Stroke) => void;
}
export function createStudio(host: HTMLDivElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor('#e9e6de');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '三维陶器画布');
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(4, 2.7, 5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 10;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x58636a, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 4);
  light.position.set(3, 5, 4);
  scene.add(light);
  const rim = new THREE.DirectionalLight(0xc1dcff, 2);
  rim.position.set(-4, 3, -2);
  scene.add(rim);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  scene.add(mesh);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: '#c4beb1', roughness: 0.8 }),
  );
  pedestal.position.y = -0.08;
  scene.add(pedestal);
  let options: StudioOptions | undefined;
  let previousProfile: ProfileControlPoint[] | undefined;
  let previousStrokes: Stroke[] | undefined;
  let draft: Stroke | undefined;
  let pointerId: number | undefined;
  let lastHit = false;
  const raycaster = new THREE.Raycaster();
  function hit(event: PointerEvent): UVPoint | undefined {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const uv = raycaster.intersectObject(mesh)[0]?.uv;
    return uv ? { u: uv.x, v: uv.y } : undefined;
  }
  function drawStroke(stroke: Stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const first = stroke.points[0];
    if (!first) return;
    // Repeat horizontally to preserve thick brush edges at U=0/1.
    for (const offset of [-2048, 0, 2048]) {
      ctx.beginPath();
      ctx.arc(
        first.u * 2048 + offset,
        (1 - first.v) * 2048,
        stroke.size / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      for (let i = 1; i < stroke.points.length; i++)
        for (const [a, b] of splitSegment(
          stroke.points[i - 1],
          stroke.points[i],
        )) {
          ctx.beginPath();
          ctx.moveTo(a.u * 2048 + offset, (1 - a.v) * 2048);
          ctx.lineTo(b.u * 2048 + offset, (1 - b.v) * 2048);
          ctx.stroke();
        }
    }
  }
  function repaint() {
    ctx.fillStyle = '#faf7ef';
    ctx.fillRect(0, 0, 2048, 2048);
    options?.strokes.forEach(drawStroke);
    if (draft) drawStroke(draft);
    texture.needsUpdate = true;
  }
  function finish(cancel = false) {
    const completed = draft;
    draft = undefined;
    lastHit = false;
    if (
      pointerId !== undefined &&
      renderer.domElement.hasPointerCapture(pointerId)
    )
      renderer.domElement.releasePointerCapture(pointerId);
    pointerId = undefined;
    if (completed && !cancel) options?.onStroke(completed);
    repaint();
  }
  function down(event: PointerEvent) {
    if (!options?.painting || event.button !== 0) return;
    const uv = hit(event);
    if (!uv) return;
    pointerId = event.pointerId;
    renderer.domElement.setPointerCapture(pointerId);
    draft = { points: [uv], size: options.brushSize, color: options.color };
    lastHit = true;
    repaint();
  }
  function move(event: PointerEvent) {
    if (!draft || pointerId !== event.pointerId) return;
    const uv = hit(event);
    if (!uv) {
      lastHit = false;
      return;
    }
    // Commit each contiguous hit path separately; never bridge a miss.
    if (!lastHit) {
      const old = draft;
      draft = { ...old, points: [uv] };
      options?.onStroke(old);
    } else draft.points.push(uv);
    lastHit = true;
    repaint();
  }
  const up = () => finish();
  const cancel = () => finish(true);
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', cancel);
  const observer = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  });
  observer.observe(host);
  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  function update(next: StudioOptions) {
    if (options?.painting && !next.painting) finish(true);
    options = next;
    controls.enabled = !next.painting;
    if (previousProfile !== next.profile) {
      const geometry = new THREE.LatheGeometry(
        sampleProfile(next.profile).map(
          (p) => new THREE.Vector2(p.radius, p.height * 2.8),
        ),
        48,
      );
      geometry.computeVertexNormals();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      previousProfile = next.profile;
    }
    if (previousStrokes !== next.strokes) {
      previousStrokes = next.strokes;
      repaint();
    }
    material.roughness = next.fired ? 0.15 : 0.85;
    material.metalness = next.fired ? 0.05 : 0;
    material.clearcoat = next.fired ? 1 : 0;
    material.clearcoatRoughness = 0.05;
    material.color.set(next.fired ? '#ffffff' : '#d5c8b6');
  }
  async function snapshot(name: string): Promise<Blob> {
    const size = renderer.getSize(new THREE.Vector2()),
      aspect = camera.aspect;
    const output = document.createElement('canvas');
    output.width = output.height = 1080;
    const out = output.getContext('2d')!;
    try {
      renderer.setSize(1080, 1080, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      out.drawImage(renderer.domElement, 0, 0, 1080, 1080);
      out.fillStyle = '#163957';
      out.font = '28px sans-serif';
      out.textAlign = 'center';
      out.fillText(name.slice(0, 28), 540, 1010);
      out.font = '16px sans-serif';
      out.fillText(`${new Date().toLocaleDateString()} · 瓷器物语`, 540, 1042);
      return await new Promise((resolve, reject) =>
        output.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
          'image/png',
        ),
      );
    } finally {
      renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  }
  return {
    update,
    snapshot,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      pedestal.geometry.dispose();
      pedestal.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
