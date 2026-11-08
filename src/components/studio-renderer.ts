import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sampleProfile } from '../core/geometry/profile';
import {
  brushAction,
  eraseAction,
  stampAction,
} from '../core/painting/actions';
import {
  azimuthToU,
  drawOffsets,
  splitSegment,
  unwrapTheta,
} from '../core/painting/strokes';
import {
  buildStampGeometry,
  getStampAsset,
  stampPlacement,
  type StampAssetId,
} from '../core/painting/stamps';
import { recipeAt } from '../core/materials/glaze';
import { rigAt } from '../core/materials/lighting';
import {
  layoutFor,
  poseFor,
  type CameraPresetId,
} from '../core/export/capture';
import type {
  PaintingAction,
  PaintTool,
  ProfileControlPoint,
  UVPoint,
} from '../types/artwork';

/** The painting texture is a fixed 2048×2048 canvas. */
const TEXTURE = 2048;
/** The ceramic body colour, painted under the pattern layer. */
const BASE_COLOUR = '#faf7ef';
/**
 * The eraser is a little wider than the brush at the same setting, so that
 * dragging it across a stroke really removes it: a brush of the same width
 * leaves the antialiased fringe of the stroke behind.
 */
const ERASER_MARGIN = 10;
const TAU = Math.PI * 2;

export interface StudioOptions {
  profile: ProfileControlPoint[];
  /** Every action that is currently painted, oldest first. */
  actions: PaintingAction[];
  /** 0 = 素坯, 1 = 白釉. */
  glaze: number;
  /** Whether the pointer may leave ink on the vessel. */
  painting: boolean;
  tool: PaintTool;
  brushSize: number;
  color: string;
  stampAssetId: StampAssetId;
  stampScale: number;
  stampRotation: number;
  preset: CameraPresetId;
  onAction: (action: PaintingAction) => void;
}

/** The stroke that is currently being dragged. */
interface Draft {
  type: 'BRUSH' | 'ERASE';
  path: UVPoint[];
  size: number;
  color: string;
  opacity: number;
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
  const ambient = new THREE.HemisphereLight(0xffffff, 0x58636a, 2.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc1dcff, 2);
  rim.position.set(-4, 3, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xdce7f2, 0.9);
  fill.position.set(-2.6, 1.8, 3.2);
  scene.add(fill);

  // Three layers: the ceramic body, the ink that has been committed, and a
  // scratch copy used to preview a live eraser. Keeping the ink on its own
  // layer is what lets the eraser remove pattern without touching the body.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE;
  const ctx = canvas.getContext('2d')!;
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = patternCanvas.height = TEXTURE;
  const patternCtx = patternCanvas.getContext('2d')!;
  const scratchCanvas = document.createElement('canvas');
  scratchCanvas.width = scratchCanvas.height = TEXTURE;
  const scratchCtx = scratchCanvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Paint the ceramic body right away: an untouched canvas is transparent and
  // would render the vessel as a black silhouette.
  ctx.fillStyle = BASE_COLOUR;
  ctx.fillRect(0, 0, TEXTURE, TEXTURE);
  // Paint the ceramic body right away: an untouched canvas is transparent and
  // would render as a black silhouette.
  ctx.fillStyle = BASE_COLOUR;
  ctx.fillRect(0, 0, TEXTURE, TEXTURE);
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
  let previousActions: PaintingAction[] | undefined;
  let previousPreset: CameraPresetId | undefined;
  let draft: Draft | undefined;
  let pointerId: number | undefined;
  /** The unwrapped azimuth of the last hit, used to keep u continuous. */
  let lastTheta: number | undefined;
  /** The continuous u of the last hit; it may leave [0,1] across the seam. */
  let lastU: number | undefined;

  const raycaster = new THREE.Raycaster();
  const localPoint = new THREE.Vector3();
  function hit(
    event: PointerEvent,
  ): { u: number; v: number; theta: number } | undefined {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const intersection = raycaster.intersectObject(mesh)[0];
    if (!intersection?.uv) return undefined;
    localPoint.copy(intersection.point);
    mesh.worldToLocal(localPoint);
    // LatheGeometry maps phi = atan2(x, z) onto u = phi / 2PI.
    const theta = Math.atan2(localPoint.x, localPoint.z);
    return { theta, u: azimuthToU(theta), v: intersection.uv.y };
  }

  /** Draws one continuous path, repeated at the neighbouring texture turns. */
  function strokePath(
    target: CanvasRenderingContext2D,
    path: UVPoint[],
    size: number,
  ) {
    if (path.length === 0) return;
    target.lineWidth = size;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    for (const offset of drawOffsets(path, TEXTURE)) {
      const first = path[0];
      target.beginPath();
      target.arc(
        first.u * TEXTURE + offset,
        (1 - first.v) * TEXTURE,
        size / 2,
        0,
        Math.PI * 2,
      );
      target.fill();
      for (let i = 1; i < path.length; i++)
        for (const [a, b] of splitSegment(path[i - 1], path[i])) {
          target.beginPath();
          target.moveTo(a.u * TEXTURE + offset, (1 - a.v) * TEXTURE);
          target.lineTo(b.u * TEXTURE + offset, (1 - b.v) * TEXTURE);
          target.stroke();
        }
    }
  }

  /** Draws one stamp motif; only strokes are drawn, so the edges stay clean. */
  function drawStamp(
    target: CanvasRenderingContext2D,
    action: Extract<PaintingAction, { type: 'STAMP' }>,
  ) {
    const asset = getStampAsset(action.assetId);
    if (!asset) return;
    const placement = stampPlacement(
      action.u,
      action.v,
      asset,
      action.scale,
      action.rotation,
    );
    const geometry = buildStampGeometry(asset.id);
    target.strokeStyle = action.color;
    target.fillStyle = action.color;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    for (const offset of [-TEXTURE, 0, TEXTURE]) {
      target.save();
      target.translate(placement.x + offset, placement.y);
      target.rotate(placement.rotation);
      const unit = placement.size / 2;
      for (const path of geometry.paths) {
        target.lineWidth = path.width * unit;
        target.beginPath();
        path.points.forEach(([x, y], index) => {
          if (index === 0) target.moveTo(x * unit, -y * unit);
          else target.lineTo(x * unit, -y * unit);
        });
        if (path.closed) target.closePath();
        target.stroke();
      }
      target.restore();
    }
  }

  /** Paints one committed action onto the ink layer. */
  function drawAction(
    target: CanvasRenderingContext2D,
    action: PaintingAction,
  ) {
    if (action.type === 'BRUSH') {
      target.globalAlpha = action.opacity;
      target.strokeStyle = action.color;
      target.fillStyle = action.color;
      strokePath(target, action.path, action.size);
      target.globalAlpha = 1;
      return;
    }
    if (action.type === 'ERASE') {
      target.globalCompositeOperation = 'destination-out';
      target.strokeStyle = '#000000';
      target.fillStyle = '#000000';
      strokePath(target, action.path, action.size);
      target.globalCompositeOperation = 'source-over';
      return;
    }
    drawStamp(target, action);
  }

  function replayAll(actions: PaintingAction[]) {
    patternCtx.clearRect(0, 0, TEXTURE, TEXTURE);
    for (const action of actions) drawAction(patternCtx, action);
  }

  /** Keeps the ink layer in step with the action list. */
  function syncActions(next: PaintingAction[]) {
    const previous = previousActions ?? [];
    let common = 0;
    while (
      common < previous.length &&
      common < next.length &&
      previous[common] === next[common]
    )
      common++;
    if (common === previous.length) {
      // Purely additive: draw the new commands on top of what is already there.
      for (let i = common; i < next.length; i++)
        drawAction(patternCtx, next[i]);
    } else {
      // Undo, redo or a reload: the layer has to be rebuilt from scratch.
      replayAll(next);
    }
    previousActions = next;
  }

  /** Composites body + ink (+ the live draft) onto the texture source. */
  function composite() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BASE_COLOUR;
    ctx.fillRect(0, 0, TEXTURE, TEXTURE);
    if (draft?.type === 'ERASE') {
      scratchCtx.globalCompositeOperation = 'source-over';
      scratchCtx.clearRect(0, 0, TEXTURE, TEXTURE);
      scratchCtx.drawImage(patternCanvas, 0, 0);
      scratchCtx.globalCompositeOperation = 'destination-out';
      scratchCtx.strokeStyle = '#000000';
      scratchCtx.fillStyle = '#000000';
      strokePath(scratchCtx, draft.path, draft.size + ERASER_MARGIN);
      scratchCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratchCanvas, 0, 0);
    } else {
      ctx.drawImage(patternCanvas, 0, 0);
      if (draft) drawAction(ctx, draft);
    }
    texture.needsUpdate = true;
  }

  let repaintFrame = 0;
  let repaintQueued = false;
  /** Coalesces texture updates: one repaint per animation frame at most. */
  function scheduleRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    repaintFrame = requestAnimationFrame(() => {
      repaintQueued = false;
      composite();
    });
  }

  function commitDraft() {
    if (!draft) return;
    const action =
      draft.type === 'ERASE'
        ? eraseAction(draft.path, draft.size + ERASER_MARGIN)
        : brushAction(draft.path, {
            size: draft.size,
            color: draft.color,
            opacity: draft.opacity,
          });
    draft = undefined;
    options?.onAction(action);
  }

  function releasePointer() {
    if (
      pointerId !== undefined &&
      renderer.domElement.hasPointerCapture(pointerId)
    )
      renderer.domElement.releasePointerCapture(pointerId);
    pointerId = undefined;
    lastTheta = undefined;
    lastU = undefined;
  }

  function finish(cancel = false) {
    if (cancel) draft = undefined;
    else commitDraft();
    releasePointer();
    scheduleRepaint();
  }

  function down(event: PointerEvent) {
    if (!options?.painting || event.button !== 0) return;
    if (pointerId !== undefined) return;
    const hitPoint = hit(event);
    if (!hitPoint) return;
    if (options.tool === 'stamp') {
      const asset = getStampAsset(options.stampAssetId);
      if (!asset) return;
      options.onAction(
        stampAction(hitPoint.u, hitPoint.v, {
          assetId: asset.id,
          color: options.color,
          scale: options.stampScale,
          rotation: options.stampRotation,
        }),
      );
      return;
    }
    pointerId = event.pointerId;
    renderer.domElement.setPointerCapture(pointerId);
    lastTheta = hitPoint.theta;
    lastU = hitPoint.u;
    draft = {
      type: options.tool === 'eraser' ? 'ERASE' : 'BRUSH',
      path: [{ u: hitPoint.u, v: hitPoint.v }],
      size: options.brushSize,
      color: options.color,
      opacity: 1,
    };
    scheduleRepaint();
  }

  function move(event: PointerEvent) {
    if (!draft || pointerId !== event.pointerId) return;
    const hitPoint = hit(event);
    if (!hitPoint) {
      // The pointer left the vessel: close this path instead of bridging the
      // empty space, and start a new one when it comes back.
      commitDraft();
      lastTheta = undefined;
      lastU = undefined;
      scheduleRepaint();
      return;
    }
    const theta =
      lastTheta === undefined
        ? hitPoint.theta
        : unwrapTheta(lastTheta, hitPoint.theta);
    const u =
      lastU === undefined
        ? azimuthToU(hitPoint.theta)
        : lastU + (theta - (lastTheta as number)) / TAU;
    lastTheta = theta;
    lastU = u;
    draft.path.push({ u, v: hitPoint.v });
    scheduleRepaint();
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

  function applyGlaze(next: StudioOptions) {
    const recipe = recipeAt(next.glaze);
    material.roughness = recipe.roughness;
    material.metalness = recipe.metalness;
    material.clearcoat = recipe.clearcoat;
    material.clearcoatRoughness = recipe.clearcoatRoughness;
    material.sheen = recipe.sheen;
    material.sheenColor.set(recipe.sheenColor);
    material.color.set(recipe.color);
    const rig = rigAt(next.glaze);
    ambient.color.set(rig.ambient.sky);
    ambient.groundColor.set(rig.ambient.ground);
    ambient.intensity = rig.ambient.intensity;
    key.color.set(rig.key.color);
    key.intensity = rig.key.intensity;
    key.position.set(...rig.key.position);
    rim.color.set(rig.rim.color);
    rim.intensity = rig.rim.intensity;
    rim.position.set(...rig.rim.position);
    fill.color.set(rig.fill.color);
    fill.intensity = rig.fill.intensity;
    fill.position.set(...rig.fill.position);
  }

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
    syncActions(next.actions);
    applyGlaze(next);
    scheduleRepaint();
    scheduleRepaint();
    if (next.preset !== previousPreset) {
      previousPreset = next.preset;
      // 'free' keeps whatever orbit the user has set up.
      if (next.preset !== 'free') {
        const pose = poseFor(next.preset);
        camera.position.set(...pose.position);
        controls.target.set(...pose.target);
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
        controls.update();
      }
    }
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
      const layout = layoutFor({ name, date: new Date() });
      out.fillStyle = layout.background;
      out.fillRect(
        0,
        layout.footerY,
        layout.width,
        layout.height - layout.footerY,
      );
      out.textAlign = 'center';
      out.textBaseline = 'alphabetic';
      out.fillStyle = '#193e53';
      out.font = `${layout.titleFont}px sans-serif`;
      out.fillText(layout.title, layout.width / 2, layout.titleY);
      out.fillStyle = '#5c7078';
      out.font = `${layout.subtitleFont}px sans-serif`;
      out.fillText(layout.subtitle, layout.width / 2, layout.subtitleY);
      out.fillStyle = '#b03a2e';
      out.fillRect(
        layout.sealX,
        layout.sealY,
        layout.sealSize,
        layout.sealSize,
      );
      out.fillStyle = '#fdf8ec';
      out.font = `${Math.round(layout.sealSize / 4.6)}px serif`;
      out.textBaseline = 'middle';
      out.fillText(
        layout.seal,
        layout.sealX + layout.sealSize / 2,
        layout.sealY + layout.sealSize / 2,
      );
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

  /** The 2048 painting texture, stored alongside the finished photo. */
  async function paintTexture(): Promise<Blob> {
    composite();
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('纹理编码失败'))),
        'image/png',
      ),
    );
  }

  return {
    update,
    snapshot,
    texture: paintTexture,
    dispose() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(repaintFrame);
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
