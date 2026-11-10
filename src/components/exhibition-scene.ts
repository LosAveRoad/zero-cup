import * as THREE from 'three';
import type { ExhibitionSceneId } from '../types/artwork';
import {
  createBackdropCanvas,
  drawInkBackdrop,
  drawLatticeBackdrop,
  drawMoonBackdrop,
} from './exhibition-backdrops';

type ThemedSceneId = Exclude<ExhibitionSceneId, 'neutral'>;
const FLOOR_Y = -0.64;
// The backdrop surrounds the full orbit and stays outside the camera's 10-unit dolly limit.
const WALL_RADIUS = 12.5;
const WALL_HEIGHT = 16;
const WALL_BOTTOM = -3.4;

const THEMES = {
  ink: {
    backdrop: drawInkBackdrop,
    ground: '#bdc8bc',
    horizon: '#a4b4a8',
    stone: '#abb9ad',
    trim: '#d5c7a8',
    keyTint: '#f7f3e7',
    light: { ambient: 0.83, key: 0.69, rim: 0.73, fill: 0.82 },
  },
  lattice: {
    backdrop: drawLatticeBackdrop,
    ground: '#77513b',
    horizon: '#332219',
    stone: '#503022',
    trim: '#bd8b55',
    keyTint: '#ffdfb6',
    light: { ambient: 0.63, key: 0.71, rim: 0.64, fill: 0.83 },
  },
  moon: {
    backdrop: drawMoonBackdrop,
    ground: '#425b68',
    horizon: '#202e3a',
    stone: '#263b47',
    trim: '#68848c',
    keyTint: '#dceaff',
    light: { ambient: 0.59, key: 0.61, rim: 0.95, fill: 0.75 },
  },
};

const floorVertex = /* glsl */ `
  varying vec2 vFloor;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFloor = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const floorFragment = /* glsl */ `
  uniform vec3 ground;
  uniform vec3 horizon;
  uniform float lattice;
  varying vec2 vFloor;

  void main() {
    float radius = length(vFloor);
    float pool = exp(-0.12 * radius * radius);
    vec3 color = mix(horizon, ground, pool);
    // Broad, soft occlusion anchors the plinth without a shadow render pass.
    vec2 shadow = (vFloor + vec2(0.28, 0.37)) * vec2(0.84, 0.69);
    color *= 1.0 - 0.52 * exp(-1.6 * dot(shadow, shadow));
    float bars = smoothstep(0.43, 0.65, cos(6.6 * (vFloor.x + 0.36 * vFloor.y)));
    color *= 1.0 - lattice * bars * smoothstep(1.1, 2.7, radius) * pool * 0.28;
    // Fine grain keeps the matte floor from looking like a flat colour fill.
    float grain = fract(sin(dot(floor(vFloor * 180.0), vec2(12.9898, 78.233))) * 43758.5453);
    color *= 0.975 + grain * 0.05;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const contactVertex = /* glsl */ `
  varying vec2 vContact;
  void main() {
    vContact = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const contactFragment = /* glsl */ `
  varying vec2 vContact;
  void main() {
    float alpha = 0.42 * (1.0 - smoothstep(0.48, 1.0, length(vContact)));
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
  }
`;

/** The scenery is owned by the existing viewport, so preview and export share it. */
export function createExhibitionScene(id: ThemedSceneId) {
  const theme = THEMES[id];
  const group = new THREE.Group();
  const backdrop = new THREE.CanvasTexture(
    createBackdropCanvas(theme.backdrop),
  );
  backdrop.colorSpace = THREE.SRGBColorSpace;
  backdrop.wrapS = THREE.RepeatWrapping;
  // Extend the sky at the top without stretching the artwork as the camera zooms out.
  backdrop.repeat.set(4, WALL_HEIGHT / 12);
  backdrop.offset.x = 0.5;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(
      WALL_RADIUS,
      WALL_RADIUS,
      WALL_HEIGHT,
      96,
      1,
      true,
    ),
    new THREE.MeshBasicMaterial({ map: backdrop, side: THREE.BackSide }),
  );
  wall.position.y = WALL_BOTTOM + WALL_HEIGHT / 2;
  group.add(wall);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(WALL_RADIUS + 0.05, 96),
    new THREE.ShaderMaterial({
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
      uniforms: {
        ground: { value: new THREE.Color(theme.ground) },
        horizon: { value: new THREE.Color(theme.horizon) },
        lattice: { value: id === 'lattice' ? 1 : 0 },
      },
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  group.add(floor);

  // Stepped lathe profile. The upper surface stays at y = 0, the vessel's foot.
  const plinth = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, FLOOR_Y],
        [1.05, FLOOR_Y],
        [1.1, -0.59],
        [1.1, -0.5],
        [1.03, -0.46],
        [1.03, -0.16],
        [1.13, -0.12],
        [1.13, -0.042],
        [1.09, 0],
        [0, 0],
      ].map(([radius, height]) => new THREE.Vector2(radius, height)),
      64,
    ),
    new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.72 }),
  );
  group.add(plinth);

  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(1.131, 0.009, 8, 64),
    new THREE.MeshStandardMaterial({
      color: theme.trim,
      metalness: 0.22,
      roughness: 0.43,
    }),
  );
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = -0.079;
  group.add(trim);

  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.ShaderMaterial({
      vertexShader: contactVertex,
      fragmentShader: contactFragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.002;
  group.add(contact);

  return {
    group,
    light: theme.light,
    keyTint: new THREE.Color(theme.keyTint),
    setFootRadius(radius: number) {
      contact.scale.setScalar(Math.min(1.08, radius * 1.4 + 0.12));
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of [wall, floor, plinth, trim, contact]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      backdrop.dispose();
      backdrop.image.width = backdrop.image.height = 0;
    },
  };
}
