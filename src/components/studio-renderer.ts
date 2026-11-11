import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createExhibitionScene } from './exhibition-scene';
import { createWoodTexture } from './material-textures';
import {
  drawFilmFrame,
  filmScenesFor,
  FILM_HEIGHT,
  FILM_WIDTH,
} from './exhibition-film';
import { FilmError, recordFilm, type FilmOptions } from './record-film';
import { sampleProfile, VESSEL_BASE_HEIGHT } from '../core/geometry/profile';
import {
  brushAction,
  eraseAction,
  stampAction,
} from '../core/painting/actions';
import {
  azimuthToU,
  createRotaryPattern,
  drawOffsets,
  extendPath,
  replicatePathBySymmetry,
  replicatePointBySymmetry,
  splitSegment,
  unwrapTheta,
} from '../core/painting/strokes';
import {
  buildStampGeometry,
  getStampAsset,
  getStampSvgPaths,
  stampPlacement,
  type StampAssetId,
} from '../core/painting/stamps';
import {
  buildCrackleNetwork,
  glazeRecipeForFinish,
  recipeAt,
  type GlazeFinishId,
} from '../core/materials/glaze';
import {
  exhibitionRigFor,
  rigAt,
  type LightingPresetId,
} from '../core/materials/lighting';
import { inkOpacityFor } from '../core/painting/inks';
import {
  layoutFor,
  poseFor,
  type CameraPresetId,
} from '../core/export/capture';
import type {
  ExhibitionSceneId,
  PaintingAction,
  PaintTool,
  ProfileControlPoint,
  SymmetryCount,
  UVPoint,
} from '../types/artwork';
import type { RotaryPatternId } from '../core/painting/strokes';

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
  /** Physical height multiplier; old saved vessels use the historical value. */
  heightScale?: number;
  /** Every action that is currently painted, oldest first. */
  actions: PaintingAction[];
  /** 0 = 素坯, 1 = 白釉. */
  glaze: number;
  /** Whether the pointer may leave ink on the vessel. */
  painting: boolean;
  /** Show the wooden display stand only in the finished-art stage. */
  showPedestal?: boolean;
  tool: PaintTool;
  brushSize: number;
  color: string;
  brushOpacity?: number;
  stampAssetId: StampAssetId;
  stampScale: number;
  stampRotation: number;
  rotaryPattern: RotaryPatternId;
  rotaryPatternSize: number;
  symmetry?: SymmetryCount;
  preset: CameraPresetId;
  cameraRevision?: number;
  lightPreset?: LightingPresetId;
  exhibitionScene?: ExhibitionSceneId;
  glazeFinish?: GlazeFinishId;
  autoRotate?: boolean;
  wireframe?: boolean;
  onAction: (action: PaintingAction) => void;
  onTapVessel?: (hit: { u: number; v: number }) => string | void;
}

const CRACKLE_SEGMENTS = buildCrackleNetwork();

/** The stroke that is currently being dragged. */
interface Draft {
  type: 'BRUSH' | 'ERASE';
  path: UVPoint[];
  size: number;
  color: string;
  opacity: number;
  symmetry?: SymmetryCount;
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
  const lifetime = new AbortController();
  let filming = false;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(4, 2.7, 5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
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
  const stampTintCanvas = document.createElement('canvas');
  const stampTintCtx = stampTintCanvas.getContext('2d')!;
  const stampImages = new Map<
    string,
    { image: HTMLImageElement; ready: Promise<void>; loaded: boolean }
  >();
  let stampReplayNeeded = false;
  let tintedStampImage: HTMLImageElement | undefined;
  let tintedStampColor = '';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Paint the ceramic body right away: an untouched canvas is transparent and
  // would render the vessel as a black silhouette.
  ctx.fillStyle = BASE_COLOUR;
  ctx.fillRect(0, 0, TEXTURE, TEXTURE);
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    side: THREE.FrontSide,
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  scene.add(mesh);
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: '#174a94',
    wireframe: true,
    transparent: true,
    opacity: 0.28,
  });
  const wireframeMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    wireframeMaterial,
  );
  wireframeMesh.visible = false;
  scene.add(wireframeMesh);
  const footCapMaterial = new THREE.MeshPhysicalMaterial({
    color: BASE_COLOUR,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  const innerMesh = new THREE.Mesh(new THREE.BufferGeometry(), footCapMaterial);
  scene.add(innerMesh);
  const footCap = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 48),
    footCapMaterial,
  );
  footCap.rotation.x = -Math.PI / 2;
  footCap.position.y = 0.005;
  scene.add(footCap);
  const wood = createWoodTexture();
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1, 0.12, 64),
    new THREE.MeshStandardMaterial({ map: wood.texture, roughness: 0.74 }),
  );
  pedestal.position.y = -0.06;
  pedestal.visible = false;
  scene.add(pedestal);
  let exhibition: ReturnType<typeof createExhibitionScene> | undefined;
  let activeScene: ExhibitionSceneId = 'neutral';

  function setExhibitionScene(id: ExhibitionSceneId) {
    if (id === activeScene) return;
    exhibition?.dispose();
    exhibition = id === 'neutral' ? undefined : createExhibitionScene(id);
    activeScene = id;
    pedestal.visible = !exhibition;
    // Keep the camera above the themed scenery's floor at every dolly distance.
    controls.maxPolarAngle = exhibition ? Math.PI / 2 + 0.13 : Math.PI;
    if (exhibition) scene.add(exhibition.group);
  }

  // Lightweight SVG cursor overlay for live brush/eraser/stamp preview & ink ripples
  const cursorSvg = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  );
  cursorSvg.setAttribute('class', 'tool-cursor-overlay');
  cursorSvg.setAttribute('aria-hidden', 'true');
  cursorSvg.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none;';
  const inkTrailGroup = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g',
  );
  inkTrailGroup.setAttribute('class', 'ink-trail-layer');
  cursorSvg.appendChild(inkTrailGroup);
  const cursorGroup = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g',
  );
  cursorSvg.appendChild(cursorGroup);
  host.appendChild(cursorSvg);

  let options: StudioOptions | undefined;
  let previousProfile: ProfileControlPoint[] | undefined;
  let previousHeightScale: number | undefined;
  let previousActions: PaintingAction[] | undefined;
  let previousPreset: CameraPresetId | undefined;
  let previousCameraRevision: number | undefined;
  let rightOrbiting = false;
  let cursorSignature = '';
  let draft: Draft | undefined;
  let rotaryPreview: PaintingAction[] = [];
  let pointerId: number | undefined;
  /** A left-button press on the finished vessel, promoted to a strike on release. */
  let tapStart:
    { x: number; y: number; hit: { u: number; v: number } } | undefined;
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

  function loadStampImage(url: string) {
    const cached = stampImages.get(url);
    if (cached) return cached;

    const image = new Image();
    image.src = url;
    const stamp = {
      image,
      loaded: false,
      ready: image.decode().then(() => {
        stamp.loaded = true;
        if (lifetime.signal.aborted) return;
        // Replay in order so a later eraser or brush mark stays above the stamp.
        stampReplayNeeded = true;
        scheduleRepaint();
      }),
    };
    stampImages.set(url, stamp);
    void stamp.ready.catch(() => stampImages.delete(url));
    return stamp;
  }

  function tintStampImage(image: HTMLImageElement, color: string) {
    if (tintedStampImage !== image || tintedStampColor !== color) {
      stampTintCanvas.width = image.naturalWidth;
      stampTintCanvas.height = image.naturalHeight;
      stampTintCtx.drawImage(image, 0, 0);
      stampTintCtx.globalCompositeOperation = 'source-in';
      stampTintCtx.fillStyle = color;
      stampTintCtx.fillRect(
        0,
        0,
        stampTintCanvas.width,
        stampTintCanvas.height,
      );
      tintedStampImage = image;
      tintedStampColor = color;
    }
    return stampTintCanvas;
  }

  /** Draws a motif on the ink layer, including transparent fills in templates. */
  function drawStamp(
    target: CanvasRenderingContext2D,
    action: Extract<PaintingAction, { type: 'STAMP' }>,
  ) {
    const asset = getStampAsset(action.assetId);
    if (!asset) return;
    let stampBitmap: HTMLCanvasElement | undefined;
    if (asset.maskUrl) {
      const stamp = loadStampImage(asset.maskUrl);
      if (!stamp.loaded) return;
      stampBitmap = tintStampImage(stamp.image, action.color);
    }
    const placement = stampPlacement(
      action.u,
      action.v,
      asset,
      action.scale,
      action.rotation,
    );
    const svgPaths = asset.svgPaths?.map(({ d, width, fill }) => ({
      path: new Path2D(d),
      width,
      fill,
    }));
    const polylines =
      svgPaths || stampBitmap ? [] : buildStampGeometry(asset.id).paths;
    const opacity = inkOpacityFor(action.color);
    target.globalAlpha = opacity;
    target.strokeStyle = action.color;
    target.fillStyle = action.color;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    for (const offset of [-TEXTURE, 0, TEXTURE]) {
      target.save();
      target.translate(placement.x + offset, placement.y);
      if (action.footprint) {
        target.scale(
          (action.footprint.u * TEXTURE) / placement.size,
          (action.footprint.v * TEXTURE) / placement.size,
        );
      }
      target.rotate(placement.rotation);
      const radius = placement.size / 2;
      if (stampBitmap) {
        target.drawImage(
          stampBitmap,
          -radius,
          -radius,
          placement.size,
          placement.size,
        );
      } else if (svgPaths) {
        target.translate(-radius, -radius);
        target.scale(placement.size / 100, placement.size / 100);
        for (const { path, width, fill } of svgPaths) {
          target.globalAlpha = opacity * (fill ?? 1);
          if (width !== undefined) {
            target.lineWidth = width;
            target.stroke(path);
          } else {
            target.fill(path, 'evenodd');
          }
        }
      } else {
        for (const path of polylines) {
          target.lineWidth = path.width * radius;
          target.beginPath();
          path.points.forEach(([x, y], index) => {
            if (index === 0) target.moveTo(x * radius, -y * radius);
            else target.lineTo(x * radius, -y * radius);
          });
          if (path.closed) target.closePath();
          target.stroke();
        }
      }
      target.restore();
    }
    target.globalAlpha = 1;
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
      const paths = replicatePathBySymmetry(action.path, action.symmetry ?? 1);
      for (const path of paths) strokePath(target, path, action.size);
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
    const copies = action.repeatCount
      ? Array.from({ length: action.repeatCount }, (_, index) => ({
          u: action.u + index / action.repeatCount!,
          v: action.v,
        }))
      : replicatePointBySymmetry(
          { u: action.u, v: action.v },
          action.symmetry ?? 1,
        );
    for (const copy of copies) {
      drawStamp(target, { ...action, u: copy.u, v: copy.v });
    }
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
    if (stampReplayNeeded) {
      stampReplayNeeded = false;
      replayAll(previousActions ?? []);
    }
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
    if (rotaryPreview.length) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      rotaryPreview.forEach((action) => drawAction(ctx, action));
      ctx.restore();
    }
    if (options && options.glaze >= 1) {
      if (options.glazeFinish === 'crackle') {
        ctx.save();
        ctx.lineCap = 'round';
        for (const seg of CRACKLE_SEGMENTS) {
          ctx.strokeStyle = seg.kind === 'iron' ? '#3d352e' : '#b88933';
          ctx.globalAlpha = seg.kind === 'iron' ? 0.34 : 0.26;
          ctx.lineWidth = seg.kind === 'iron' ? 3.2 : 1.8;
          ctx.beginPath();
          ctx.moveTo(seg.from[0] * TEXTURE, (1 - seg.from[1]) * TEXTURE);
          ctx.lineTo(seg.to[0] * TEXTURE, (1 - seg.to[1]) * TEXTURE);
          ctx.stroke();
        }
        ctx.restore();
      } else if (options.glazeFinish === 'gilded') {
        ctx.save();
        ctx.fillStyle = '#d4af37';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, 0, TEXTURE, 26);
        ctx.fillRect(0, 34, TEXTURE, 6);
        ctx.fillRect(0, TEXTURE - 28, TEXTURE, 28);
        ctx.restore();
      }
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
            symmetry: draft.symmetry,
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

  /** Appends an authentic, finely detailed Chinese calligraphy brush (湖笔) reticle. */
  function appendCalligraphyBrush(target: SVGGElement, inkColor: string) {
    const brushGroup = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );
    brushGroup.setAttribute('class', 'calligraphy-brush-reticle');
    brushGroup.style.transition = 'transform 0.12s ease-out';

    // Subtle, understated ink contact dot right at the tip (0, 0)
    const contactDot = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    contactDot.setAttribute('cx', '0');
    contactDot.setAttribute('cy', '0');
    contactDot.setAttribute('r', '2');
    contactDot.setAttribute('fill', inkColor);
    contactDot.setAttribute('opacity', '0.42');
    brushGroup.appendChild(contactDot);

    // Silk hanging loop at top of brush handle (笔挂丝绦)
    const silkLoop = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    silkLoop.setAttribute('d', 'M 42 -46 Q 47 -52 44 -55 Q 40 -52 41 -45');
    silkLoop.setAttribute('fill', 'none');
    silkLoop.setAttribute('stroke', '#8c2d19');
    silkLoop.setAttribute('stroke-width', '1.1');
    brushGroup.appendChild(silkLoop);

    // Tapered bamboo & rosewood brush shaft (湘妃竹笔管)
    const shaftBody = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    shaftBody.setAttribute(
      'd',
      'M 10.5 -15.5 L 39.5 -46.5 Q 42.5 -47.5 43.2 -44.2 L 15.2 -11.2 Z',
    );
    shaftBody.setAttribute('fill', '#9c7144');
    shaftBody.setAttribute('stroke', '#3d2817');
    shaftBody.setAttribute('stroke-width', '1.1');
    shaftBody.setAttribute('stroke-linejoin', 'round');
    brushGroup.appendChild(shaftBody);

    // Specular wood highlight ridge along the brush handle
    const shaftHighlight = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    shaftHighlight.setAttribute('x1', '12.5');
    shaftHighlight.setAttribute('y1', '-14.8');
    shaftHighlight.setAttribute('x2', '39.8');
    shaftHighlight.setAttribute('y2', '-44.2');
    shaftHighlight.setAttribute('stroke', '#cfa978');
    shaftHighlight.setAttribute('stroke-width', '1.4');
    shaftHighlight.setAttribute('stroke-linecap', 'round');
    brushGroup.appendChild(shaftHighlight);

    // Subtle bamboo node ring (竹节纹)
    const bambooNode = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    bambooNode.setAttribute('x1', '24.5');
    bambooNode.setAttribute('y1', '-30.5');
    bambooNode.setAttribute('x2', '28.5');
    bambooNode.setAttribute('y2', '-26.8');
    bambooNode.setAttribute('stroke', '#4a321d');
    bambooNode.setAttribute('stroke-width', '1.2');
    brushGroup.appendChild(bambooNode);

    // Ox-horn top finial cap (牛角笔顶)
    const topCap = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    topCap.setAttribute(
      'd',
      'M 38.2 -45.2 L 40.5 -47.5 Q 43.5 -48 44 -45 L 41.8 -42.5 Z',
    );
    topCap.setAttribute('fill', '#2b211b');
    brushGroup.appendChild(topCap);

    // Carved ferrule collar with gold trim (笔斗与金箍)
    const ferrule = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    ferrule.setAttribute(
      'd',
      'M 8.2 -12.6 L 11.2 -15.8 L 15.6 -11.6 L 12.4 -8.4 Z',
    );
    ferrule.setAttribute('fill', '#231c18');
    ferrule.setAttribute('stroke', '#1a1410');
    ferrule.setAttribute('stroke-width', '0.8');
    brushGroup.appendChild(ferrule);

    const goldRing = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    goldRing.setAttribute('x1', '10.6');
    goldRing.setAttribute('y1', '-15.2');
    goldRing.setAttribute('x2', '15.0');
    goldRing.setAttribute('y2', '-11.0');
    goldRing.setAttribute('stroke', '#d4af37');
    goldRing.setAttribute('stroke-width', '1.3');
    brushGroup.appendChild(goldRing);

    // Plump white goat/wolf hair brush belly (饱满羊毫/狼毫笔肚)
    const bristleBelly = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    bristleBelly.setAttribute(
      'd',
      'M 0 0 C 1.2 -5.8, 3.8 -10.8, 8.5 -12.8 L 12.6 -8.6 C 10.4 -4.0, 5.6 -1.2, 0 0 Z',
    );
    bristleBelly.setAttribute('fill', '#f5f0e2');
    bristleBelly.setAttribute('stroke', '#5c5245');
    bristleBelly.setAttribute('stroke-width', '0.85');
    brushGroup.appendChild(bristleBelly);

    // Cobalt-soaked front brush tip (蘸满苏麻离青的笔锋毫尖)
    const cobaltTip = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    cobaltTip.setAttribute(
      'd',
      'M 0 0 C 0.9 -3.8, 2.5 -7.2, 5.4 -9.2 Q 7.2 -8.4, 8.8 -5.6 C 6.6 -2.6, 3.6 -0.8, 0 0 Z',
    );
    cobaltTip.setAttribute('fill', inkColor);
    brushGroup.appendChild(cobaltTip);

    // Fine bristle hair texture lines
    const hairLine = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    hairLine.setAttribute('d', 'M 1.4 -1.6 Q 4.5 -5.8 9.2 -10.2');
    hairLine.setAttribute('fill', 'none');
    hairLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.45)');
    hairLine.setAttribute('stroke-width', '0.65');
    brushGroup.appendChild(hairLine);

    target.appendChild(brushGroup);
  }

  /** Updates the SVG cursor preview to match the current tool & stamp geometry. */
  function syncCursorShape(current: StudioOptions) {
    const nextSignature = `${current.tool}:${current.brushSize}:${current.color}:${current.stampAssetId}:${current.stampScale}:${current.stampRotation}`;
    if (nextSignature === cursorSignature) return;
    cursorSignature = nextSignature;
    cursorGroup.replaceChildren();
    if (current.tool === 'stamp') {
      const asset = getStampAsset(current.stampAssetId);
      if (!asset) return;
      const previewScale = (asset.size * current.stampScale * 0.22) / 100;
      const deg = (current.stampRotation * 180) / Math.PI;
      const motifGroup = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'g',
      );
      motifGroup.setAttribute(
        'transform',
        `rotate(${deg.toFixed(1)}) scale(${previewScale}) translate(-50 -50)`,
      );
      motifGroup.setAttribute('opacity', '0.72');
      if (asset.maskUrl) {
        const rect = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'rect',
        );
        rect.setAttribute('class', 'stamp-wash');
        rect.setAttribute('width', '100');
        rect.setAttribute('height', '100');
        rect.setAttribute('fill', current.color);
        rect.style.maskImage = `url("${asset.maskUrl}")`;
        motifGroup.appendChild(rect);
      } else
        for (const { d, width, fill } of getStampSvgPaths(asset.id)) {
          const el = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'path',
          );
          el.setAttribute('d', d);
          el.setAttribute('fill', fill === undefined ? 'none' : current.color);
          el.setAttribute('fill-rule', 'evenodd');
          el.setAttribute('fill-opacity', String(fill ?? 1));
          if (width !== undefined) {
            el.setAttribute('stroke', current.color);
            el.setAttribute('stroke-width', String(width));
          }
          el.setAttribute('stroke-linecap', 'round');
          el.setAttribute('stroke-linejoin', 'round');
          motifGroup.appendChild(el);
        }
      cursorGroup.appendChild(motifGroup);
      appendCalligraphyBrush(cursorGroup, current.color);
      return;
    }
    if (current.tool === 'brush') {
      appendCalligraphyBrush(cursorGroup, current.color);
      return;
    }
    if (current.tool === 'rotary') {
      appendCalligraphyBrush(cursorGroup, current.color);
      return;
    }
    const circle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    const radius = Math.max(
      4,
      ((current.brushSize + ERASER_MARGIN) * 0.32) / 2,
    );
    circle.setAttribute('r', radius.toFixed(1));
    circle.setAttribute('fill', 'rgba(255,255,255,0.28)');
    circle.setAttribute('stroke', '#a65728');
    circle.setAttribute('stroke-width', '1.6');
    circle.setAttribute('stroke-dasharray', '3 2');
    cursorGroup.appendChild(circle);
  }

  let strikeResetTimer = 0;

  /** Builds the small metallic striker rod SVG cursor for finished porcelain. */
  function syncMetalRodCursor() {
    if (cursorSignature === 'metal-rod') return;
    cursorSignature = 'metal-rod';
    cursorGroup.replaceChildren();

    const ripple = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    ripple.setAttribute('class', 'metal-rod-ripple');
    ripple.setAttribute('cx', '0');
    ripple.setAttribute('cy', '0');
    ripple.setAttribute('r', '4');
    ripple.setAttribute('fill', 'none');
    ripple.setAttribute('stroke', '#316698');
    ripple.setAttribute('stroke-width', '1.8');
    ripple.setAttribute('opacity', '0');
    cursorGroup.appendChild(ripple);

    const rodGroup = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );
    rodGroup.setAttribute('class', 'metal-rod-graphic');
    rodGroup.style.transition = 'transform 0.11s ease-out';

    const borderShaft = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    borderShaft.setAttribute('x1', '3');
    borderShaft.setAttribute('y1', '3');
    borderShaft.setAttribute('x2', '34');
    borderShaft.setAttribute('y2', '34');
    borderShaft.setAttribute('stroke', '#36495c');
    borderShaft.setAttribute('stroke-width', '5.2');
    borderShaft.setAttribute('stroke-linecap', 'round');
    rodGroup.appendChild(borderShaft);

    const metalShaft = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    metalShaft.setAttribute('x1', '3');
    metalShaft.setAttribute('y1', '3');
    metalShaft.setAttribute('x2', '22');
    metalShaft.setAttribute('y2', '22');
    metalShaft.setAttribute('stroke', '#dce5ee');
    metalShaft.setAttribute('stroke-width', '3.2');
    metalShaft.setAttribute('stroke-linecap', 'round');
    rodGroup.appendChild(metalShaft);

    const brassGrip = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    brassGrip.setAttribute('x1', '21');
    brassGrip.setAttribute('y1', '21');
    brassGrip.setAttribute('x2', '34');
    brassGrip.setAttribute('y2', '34');
    brassGrip.setAttribute('stroke', '#c89b48');
    brassGrip.setAttribute('stroke-width', '3.8');
    brassGrip.setAttribute('stroke-linecap', 'round');
    rodGroup.appendChild(brassGrip);

    const strikerHead = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    strikerHead.setAttribute('cx', '0');
    strikerHead.setAttribute('cy', '0');
    strikerHead.setAttribute('r', '4');
    strikerHead.setAttribute('fill', '#eef4fa');
    strikerHead.setAttribute('stroke', '#36495c');
    strikerHead.setAttribute('stroke-width', '1.4');
    rodGroup.appendChild(strikerHead);

    const specularDot = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    specularDot.setAttribute('cx', '-1.2');
    specularDot.setAttribute('cy', '-1.2');
    specularDot.setAttribute('r', '1.3');
    specularDot.setAttribute('fill', '#ffffff');
    rodGroup.appendChild(specularDot);

    cursorGroup.appendChild(rodGroup);
  }

  function triggerRodStrike(x: number, y: number, noteLabel?: string) {
    const rodGroup = cursorGroup.querySelector(
      '.metal-rod-graphic',
    ) as SVGGElement | null;
    const ripple = cursorGroup.querySelector(
      '.metal-rod-ripple',
    ) as SVGCircleElement | null;
    if (rodGroup) {
      rodGroup.setAttribute('transform', 'rotate(-20) translate(-2, -1)');
      window.clearTimeout(strikeResetTimer);
      strikeResetTimer = window.setTimeout(() => {
        rodGroup.setAttribute('transform', 'rotate(0)');
      }, 120);
    }
    if (ripple && typeof ripple.animate === 'function') {
      ripple.animate(
        [
          { r: '4px', opacity: 0.85, strokeWidth: '2.2px' },
          { r: '26px', opacity: 0, strokeWidth: '0.6px' },
        ],
        { duration: 360, easing: ' cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    if (noteLabel) {
      // Anchor at (x, y - 10) so scale() inside innerGroup expands around (0, 0)
      // and floats straight upward without SVG coordinate-origin drift.
      const anchor = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'g',
      );
      anchor.setAttribute(
        'transform',
        `translate(${x.toFixed(1)}, ${(y - 10).toFixed(1)})`,
      );
      const innerGroup = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'g',
      );
      innerGroup.setAttribute('class', 'chime-note-glyph');
      const glyph = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'text',
      );
      glyph.setAttribute('x', '0');
      glyph.setAttribute('y', '0');
      glyph.setAttribute('text-anchor', 'middle');
      glyph.setAttribute('dominant-baseline', 'central');
      glyph.setAttribute('fill', '#14365d');
      glyph.setAttribute(
        'font-family',
        "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
      );
      glyph.setAttribute('font-size', '17');
      glyph.setAttribute('font-weight', '700');
      glyph.textContent = noteLabel;
      innerGroup.appendChild(glyph);
      anchor.appendChild(innerGroup);
      inkTrailGroup.appendChild(anchor);

      const startTime = performance.now();
      const duration = 840;
      const stepNote = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        const easeOut = 1 - Math.pow(1 - t, 3);
        const dy = -48 * easeOut;
        const scale = 0.85 + 0.72 * easeOut;
        const opacity = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
        innerGroup.setAttribute(
          'transform',
          `translate(0, ${dy.toFixed(1)}) scale(${scale.toFixed(2)})`,
        );
        innerGroup.setAttribute('opacity', opacity.toFixed(2));
        if (t < 1) {
          requestAnimationFrame(stepNote);
        } else {
          anchor.remove();
        }
      };
      requestAnimationFrame(stepNote);
    }
  }

  function setBrushPressState(pressed: boolean) {
    const brushGroup = cursorGroup.querySelector(
      '.calligraphy-brush-reticle',
    ) as SVGGElement | null;
    if (brushGroup) {
      brushGroup.setAttribute(
        'transform',
        pressed ? 'rotate(-5) scale(0.97)' : 'rotate(0) scale(1)',
      );
    }
  }

  function hideCursor() {
    cursorSvg.style.display = 'none';
    if (rotaryPreview.length) {
      rotaryPreview = [];
      scheduleRepaint();
    }
    delete cursorSvg.dataset.cursor;
    delete renderer.domElement.dataset.cursor;
    renderer.domElement.style.cursor = '';
  }

  function finish(cancel = false) {
    if (cancel) draft = undefined;
    else commitDraft();
    setBrushPressState(false);
    if (rightOrbiting) {
      rightOrbiting = false;
      controls.enabled = !options?.painting;
    }
    releasePointer();
    scheduleRepaint();
  }

  function down(event: PointerEvent) {
    if (filming) return;
    if (!options?.painting) {
      if (options && options.glaze >= 1 && event.button === 0) {
        const hitPoint = hit(event);
        if (hitPoint) {
          const rect = renderer.domElement.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          syncMetalRodCursor();
          cursorSvg.style.display = 'block';
          cursorSvg.dataset.cursor = 'metal-rod';
          renderer.domElement.dataset.cursor = 'metal-rod';
          renderer.domElement.style.cursor = 'none';
          cursorGroup.setAttribute(
            'transform',
            `translate(${localX.toFixed(1)}, ${localY.toFixed(1)})`,
          );
          // Strike on release, not on press: dragging to orbit also starts with
          // a left-button press and must not ring the vessel.
          tapStart = { x: localX, y: localY, hit: hitPoint };
        }
      }
      return;
    }
    if (event.button === 2) return;
    if (event.button !== 0) return;
    if (pointerId !== undefined) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    syncCursorShape(options);
    cursorSvg.style.display = 'block';
    cursorSvg.dataset.cursor = 'paint-tool';
    renderer.domElement.dataset.cursor = 'brush-reticle';
    renderer.domElement.style.cursor = 'none';
    cursorGroup.setAttribute(
      'transform',
      `translate(${localX.toFixed(1)}, ${localY.toFixed(1)})`,
    );
    setBrushPressState(true);
    const hitPoint = hit(event);
    if (!hitPoint) return;
    if (options.tool === 'rotary') {
      const actions = createRotaryPattern(
        options.rotaryPattern,
        options.color,
        hitPoint.u,
        hitPoint.v,
        options.rotaryPatternSize,
        options.profile,
        options.heightScale ?? 1,
      );
      rotaryPreview = [];
      actions.forEach((action) => options?.onAction(action));
      setBrushPressState(false);
      scheduleRepaint();
      return;
    }
    if (options.tool === 'stamp') {
      const asset = getStampAsset(options.stampAssetId);
      if (!asset) return;
      options.onAction(
        stampAction(hitPoint.u, hitPoint.v, {
          assetId: asset.id,
          color: options.color,
          scale: options.stampScale,
          rotation: options.stampRotation,
          symmetry: options.symmetry,
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
      opacity:
        options.tool === 'eraser'
          ? 1
          : (options.brushOpacity ?? inkOpacityFor(options.color)),
      symmetry: options.symmetry,
    };
    scheduleRepaint();
  }

  function move(event: PointerEvent) {
    if (filming) return;
    if (!draft && !options?.painting && options && options.glaze >= 1) {
      if (event.buttons === 0) {
        const hitPoint = hit(event);
        if (hitPoint) {
          const rect = renderer.domElement.getBoundingClientRect();
          syncMetalRodCursor();
          cursorSvg.style.display = 'block';
          cursorSvg.dataset.cursor = 'metal-rod';
          renderer.domElement.dataset.cursor = 'metal-rod';
          renderer.domElement.style.cursor = 'none';
          cursorGroup.setAttribute(
            'transform',
            `translate(${(event.clientX - rect.left).toFixed(1)}, ${(event.clientY - rect.top).toFixed(1)})`,
          );
        } else {
          hideCursor();
        }
      }
      return;
    }
    if (!draft && options?.painting && !rightOrbiting && event.buttons === 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      syncCursorShape(options);
      cursorSvg.style.display = 'block';
      cursorSvg.dataset.cursor = 'paint-tool';
      renderer.domElement.dataset.cursor = 'brush-reticle';
      renderer.domElement.style.cursor = 'none';
      cursorGroup.setAttribute(
        'transform',
        `translate(${localX.toFixed(1)}, ${localY.toFixed(1)})`,
      );
      if (options.tool === 'rotary') {
        const hitPoint = hit(event);
        const nextPreview = hitPoint
          ? createRotaryPattern(
              options.rotaryPattern,
              options.color,
              hitPoint.u,
              hitPoint.v,
              options.rotaryPatternSize,
              options.profile,
              options.heightScale ?? 1,
            )
          : [];
        rotaryPreview = nextPreview;
        scheduleRepaint();
      } else if (rotaryPreview.length) {
        rotaryPreview = [];
        scheduleRepaint();
      }
      return;
    }
    if (!draft || pointerId !== event.pointerId) return;
    if (options?.painting) {
      const rect = renderer.domElement.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      cursorGroup.setAttribute(
        'transform',
        `translate(${localX.toFixed(1)}, ${localY.toFixed(1)})`,
      );
    }
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
    // extendPath keeps the sample continuous with the previous one and drops
    // points that are too close, so a slow drag does not bloat the command.
    draft.path = extendPath(draft.path, { u, v: hitPoint.v });
    scheduleRepaint();
  }

  /** Pointer travel (CSS px) under which a press on the vessel counts as a tap. */
  const TAP_SLOP = 5;

  const up = (event: PointerEvent) => {
    const tap = tapStart;
    tapStart = undefined;
    if (tap && options && options.glaze >= 1 && !options.painting) {
      const rect = renderer.domElement.getBoundingClientRect();
      const dx = event.clientX - rect.left - tap.x;
      const dy = event.clientY - rect.top - tap.y;
      if (Math.hypot(dx, dy) <= TAP_SLOP) {
        const noteLabel = options.onTapVessel?.({
          u: tap.hit.u,
          v: tap.hit.v,
        });
        triggerRodStrike(
          tap.x,
          tap.y,
          typeof noteLabel === 'string' ? noteLabel : undefined,
        );
      }
    }
    finish();
  };
  const cancel = () => {
    tapStart = undefined;
    finish(true);
  };
  const leave = () => hideCursor();
  const suppressContextMenu = (event: MouseEvent) => {
    if (options?.painting) event.preventDefault();
  };
  /**
   * OrbitControls ignores a pointerdown it receives while `enabled` is false, so
   * enabling orbiting from the canvas listener would be too late to start the
   * gesture. Capture on the host runs before the canvas listeners the controls
   * own, which lets a painting-stage right-drag orbit as the hint promises.
   */
  const startRightOrbit = (event: PointerEvent) => {
    if (!options?.painting || event.button !== 2) return;
    rightOrbiting = true;
    controls.enabled = true;
    hideCursor();
  };
  host.addEventListener('pointerdown', startRightOrbit, { capture: true });
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', cancel);
  renderer.domElement.addEventListener('pointerleave', leave);
  renderer.domElement.addEventListener('contextmenu', suppressContextMenu);
  function resizePreview() {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(() => {
    if (!filming) resizePreview();
  });
  observer.observe(host);
  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    if (filming) return;
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function applyGlaze(next: StudioOptions) {
    const recipe =
      next.glaze >= 1 && next.glazeFinish && next.glazeFinish !== 'white'
        ? glazeRecipeForFinish(next.glazeFinish)
        : recipeAt(next.glaze);
    material.roughness = recipe.roughness;
    material.metalness = recipe.metalness;
    material.clearcoat = recipe.clearcoat;
    material.clearcoatRoughness = recipe.clearcoatRoughness;
    material.sheen = recipe.sheen;
    material.sheenColor.set(recipe.sheenColor);
    material.color.set(recipe.color);
    footCapMaterial.roughness = recipe.roughness;
    footCapMaterial.metalness = recipe.metalness;
    footCapMaterial.clearcoat = recipe.clearcoat;
    footCapMaterial.clearcoatRoughness = recipe.clearcoatRoughness;
    footCapMaterial.sheen = recipe.sheen;
    footCapMaterial.sheenColor.set(recipe.sheenColor);
    footCapMaterial.color.set(recipe.color);
    applyLighting(next, exhibition);
  }

  function applyLighting(next: StudioOptions, backdrop: typeof exhibition) {
    const rig =
      next.glaze >= 1 && next.lightPreset
        ? exhibitionRigFor(next.lightPreset)
        : rigAt(next.glaze);
    ambient.color.set(rig.ambient.sky);
    ambient.groundColor.set(rig.ambient.ground);
    ambient.intensity = rig.ambient.intensity * (backdrop?.light.ambient ?? 1);
    key.color.set(rig.key.color);
    if (backdrop) key.color.lerp(backdrop.keyTint, 0.45);
    key.intensity = rig.key.intensity * (backdrop?.light.key ?? 1);
    key.position.set(...rig.key.position);
    rim.color.set(rig.rim.color);
    rim.intensity = rig.rim.intensity * (backdrop?.light.rim ?? 1);
    rim.position.set(...rig.rim.position);
    fill.color.set(rig.fill.color);
    fill.intensity = rig.fill.intensity * (backdrop?.light.fill ?? 1);
    fill.position.set(...rig.fill.position);
  }

  function update(next: StudioOptions) {
    if (filming) return;
    if (options?.painting && !next.painting) finish(true);
    if (!next.painting) hideCursor();
    options = next;
    if (!rightOrbiting) controls.enabled = !next.painting;
    controls.autoRotate = Boolean(next.autoRotate);
    controls.autoRotateSpeed = 2.2;
    wireframeMesh.visible = Boolean(next.wireframe);
    if (
      previousProfile !== next.profile ||
      previousHeightScale !== (next.heightScale ?? 1)
    ) {
      const sampled = sampleProfile(next.profile);
      const physicalHeight = (height: number) =>
        height * VESSEL_BASE_HEIGHT * (next.heightScale ?? 1);
      const geometry = new THREE.LatheGeometry(
        sampled.map(
          (p) => new THREE.Vector2(p.radius, physicalHeight(p.height)),
        ),
        48,
      );
      geometry.computeVertexNormals();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      wireframeMesh.geometry = geometry;

      // Build the unpatterned interior wall & rounded mouth rim with physical wall thickness
      const wallThickness = 0.036;
      const topSample = sampled[sampled.length - 1] ?? {
        radius: 0.25,
        height: 1,
      };
      const outerRimR = topSample.radius;
      const topY = physicalHeight(topSample.height);
      const lipT = Math.min(wallThickness, outerRimR * 0.24);
      const lipMidR = outerRimR - lipT / 2;
      const lipHalf = lipT / 2;
      const innerProfilePoints: THREE.Vector2[] = [];
      const lipSteps = 6;
      for (let s = 0; s <= lipSteps; s++) {
        const theta = (s / lipSteps) * Math.PI;
        innerProfilePoints.push(
          new THREE.Vector2(
            lipMidR + Math.cos(theta) * lipHalf,
            topY + Math.sin(theta) * (lipHalf * 0.85),
          ),
        );
      }
      for (let i = sampled.length - 2; i >= 1; i--) {
        const p = sampled[i];
        const localT = Math.min(wallThickness, p.radius * 0.24);
        innerProfilePoints.push(
          new THREE.Vector2(
            Math.max(0.035, p.radius - localT),
            Math.max(wallThickness, physicalHeight(p.height)),
          ),
        );
      }
      innerProfilePoints.push(new THREE.Vector2(0, wallThickness));
      const innerGeo = new THREE.LatheGeometry(innerProfilePoints, 48);
      innerGeo.computeVertexNormals();
      innerMesh.geometry.dispose();
      innerMesh.geometry = innerGeo;

      const footRadius = Math.max(0.06, (sampled[0]?.radius ?? 0.2) * 0.98);
      footCap.geometry.dispose();
      footCap.geometry = new THREE.CircleGeometry(footRadius, 48);
      previousProfile = next.profile;
      previousHeightScale = next.heightScale ?? 1;
    }
    setExhibitionScene(next.exhibitionScene ?? 'neutral');
    pedestal.visible = Boolean(next.showPedestal) && !exhibition;
    exhibition?.setFootRadius(next.profile[0]?.radius ?? 0.2);
    syncActions(next.actions);
    applyGlaze(next);
    scheduleRepaint();
    if (
      next.preset !== previousPreset ||
      next.cameraRevision !== previousCameraRevision
    ) {
      previousPreset = next.preset;
      previousCameraRevision = next.cameraRevision;
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

  async function waitForStampImages() {
    const pending = new Set<Promise<void>>();
    for (const action of previousActions ?? []) {
      if (action.type !== 'STAMP') continue;
      const url = getStampAsset(action.assetId)?.maskUrl;
      if (!url) continue;
      const stamp = loadStampImage(url);
      if (!stamp.loaded) pending.add(stamp.ready);
    }
    await Promise.all(pending);
    lifetime.signal.throwIfAborted();
  }

  async function video(filmOptions: FilmOptions) {
    if (filming) throw new FilmError('正在生成视频，请稍候。');
    const studioOptions = options;
    if (!studioOptions) throw new FilmError('三维视口尚未就绪。');
    const pixelRatio = renderer.getPixelRatio();
    const previousControls = controls.enabled;
    const previousWireframe = wireframeMesh.visible;
    const signal = AbortSignal.any([filmOptions.signal, lifetime.signal]);
    signal.throwIfAborted();
    const filmCamera = new THREE.PerspectiveCamera(
      38,
      FILM_WIDTH / FILM_HEIGHT,
      camera.near,
      camera.far,
    );
    const title = filmOptions.name.trim() || '未命名作品';
    const frontAzimuth = Math.atan2(
      camera.position.x - controls.target.x,
      camera.position.z - controls.target.z,
    );
    const scenes = filmScenesFor(activeScene, filmOptions.multipleScenes);
    const extraScenes = new Map<
      ExhibitionSceneId,
      ReturnType<typeof createExhibitionScene>
    >();
    const disposeExtraScenes = () => {
      for (const backdrop of extraScenes.values()) backdrop.dispose();
      extraScenes.clear();
    };
    let visibleBackdrop = exhibition;
    const showBackdrop = (id: ExhibitionSceneId) => {
      const backdrop = id === activeScene ? exhibition : extraScenes.get(id);
      if (visibleBackdrop === backdrop) return;
      if (visibleBackdrop) visibleBackdrop.group.visible = false;
      if (backdrop) backdrop.group.visible = true;
      pedestal.visible = Boolean(studioOptions.showPedestal) && !backdrop;
      applyLighting(studioOptions, backdrop);
      visibleBackdrop = backdrop;
    };

    filming = true;
    signal.addEventListener('abort', disposeExtraScenes, { once: true });
    try {
      await waitForStampImages();
      signal.throwIfAborted();
      hideCursor();
      tapStart = undefined;
      controls.enabled = false;
      wireframeMesh.visible = false;
      renderer.setPixelRatio(1);
      renderer.setSize(FILM_WIDTH, FILM_HEIGHT, false);
      if (repaintQueued) {
        cancelAnimationFrame(repaintFrame);
        repaintQueued = false;
        composite();
      }
      for (const id of new Set(scenes)) {
        if (id === activeScene || id === 'neutral') continue;
        const backdrop = createExhibitionScene(id);
        backdrop.setFootRadius(studioOptions.profile[0]?.radius ?? 0.2);
        backdrop.group.visible = false;
        extraScenes.set(id, backdrop);
        scene.add(backdrop.group);
      }
      // Upload the backdrops before the first recorded frame so the dissolves
      // don't have to allocate textures while the camera is moving.
      filmCamera.position.copy(camera.position);
      filmCamera.lookAt(controls.target);
      for (const id of extraScenes.keys()) {
        showBackdrop(id);
        renderer.render(scene, filmCamera);
      }

      return await recordFilm(
        { ...filmOptions, signal },
        host,
        (ctx, elapsed) => {
          drawFilmFrame(
            ctx,
            elapsed,
            title,
            scenes,
            ([azimuth, elevation, distance, target], id) => {
              if (renderer.getContext().isContextLost()) {
                throw new FilmError('三维视口已断开，请刷新页面后重试。');
              }
              showBackdrop(id);
              const horizontal = Math.cos(elevation) * distance;
              filmCamera.position.set(
                Math.sin(frontAzimuth + azimuth) * horizontal,
                target + Math.sin(elevation) * distance,
                Math.cos(frontAzimuth + azimuth) * horizontal,
              );
              filmCamera.lookAt(0, target, 0);
              renderer.render(scene, filmCamera);
              return renderer.domElement;
            },
          );
        },
      );
    } finally {
      signal.removeEventListener('abort', disposeExtraScenes);
      disposeExtraScenes();
      filming = false;
      if (!lifetime.signal.aborted) {
        if (exhibition) exhibition.group.visible = true;
        pedestal.visible = Boolean(studioOptions.showPedestal) && !exhibition;
        applyLighting(studioOptions, exhibition);
        controls.enabled = previousControls;
        wireframeMesh.visible = previousWireframe;
        renderer.setPixelRatio(pixelRatio);
        resizePreview();
      }
    }
  }

  async function snapshot(name: string): Promise<Blob> {
    await waitForStampImages();
    if (repaintQueued || stampReplayNeeded) composite();
    const size = renderer.getSize(new THREE.Vector2()),
      aspect = camera.aspect;
    const layout = layoutFor({ name, date: new Date() });
    // Render themed shots within the photo area above the caption.
    const photoHeight = exhibition ? layout.footerY : layout.height;
    const output = document.createElement('canvas');
    output.width = layout.width;
    output.height = layout.height;
    const out = output.getContext('2d')!;
    try {
      renderer.setSize(layout.width, photoHeight, false);
      camera.aspect = layout.width / photoHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      out.drawImage(renderer.domElement, 0, 0, layout.width, photoHeight);
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
    await waitForStampImages();
    composite();
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('纹理编码失败'))),
        'image/png',
      ),
    );
  }

  /** Returns the u coordinate currently facing the centre of the camera. */
  function frontU(): number {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersection = raycaster.intersectObject(mesh)[0];
    if (intersection) {
      localPoint.copy(intersection.point);
      mesh.worldToLocal(localPoint);
      return azimuthToU(Math.atan2(localPoint.x, localPoint.z));
    }
    localPoint.copy(camera.position);
    mesh.worldToLocal(localPoint);
    return azimuthToU(Math.atan2(localPoint.x, localPoint.z));
  }

  return {
    update,
    snapshot,
    video,
    texture: paintTexture,
    frontU,
    dispose() {
      lifetime.abort();
      stampImages.clear();
      stampTintCanvas.width = stampTintCanvas.height = 0;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(repaintFrame);
      window.clearTimeout(strikeResetTimer);
      observer.disconnect();
      controls.dispose();
      host.removeEventListener('pointerdown', startRightOrbit, {
        capture: true,
      });
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      renderer.domElement.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener(
        'contextmenu',
        suppressContextMenu,
      );
      cursorSvg.remove();
      mesh.geometry.dispose();
      innerMesh.geometry.dispose();
      material.dispose();
      wireframeMaterial.dispose();
      footCap.geometry.dispose();
      footCapMaterial.dispose();
      texture.dispose();
      exhibition?.dispose();
      pedestal.geometry.dispose();
      pedestal.material.dispose();
      wood.texture.dispose();
      wood.canvas.width = wood.canvas.height = 0;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
