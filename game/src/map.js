// Kestrel Yard — abandoned dusk industrial yard, ~44 x 36 m.
// Built entirely from data tables: every entry is a plain box or cylinder,
// every mesh is both a collider (Box3) and a shootable. No models, no
// textures, no network. Geometry/materials are cached by size/name so the
// build allocates once and the hot loop allocates nothing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [w, h, d, x, y, z, material] — y is the box centre.
const BOXES = [
  // Floor + perimeter walls (4.6 m).
  [44.4, 0.4, 36.4, 0, -0.2, 0, 'floor'],
  [0.4, 4.6, 36.4, -22.2, 2.3, 0, 'surface'],
  [0.4, 4.6, 36.4, 22.2, 2.3, 0, 'surface'],
  [44.4, 4.6, 0.4, 0, 2.3, -18.2, 'surface'],
  [44.4, 4.6, 0.4, 0, 2.3, 18.2, 'surface'],
  // Site A "CRANE BAY" (-14,-12): gantry crane silhouette over the site.
  [0.5, 4.4, 0.5, -17.5, 2.2, -14.5, 'hairline'],
  [0.5, 4.4, 0.5, -10.5, 2.2, -14.5, 'hairline'],
  [0.5, 4.4, 0.5, -17.5, 2.2, -9.5, 'hairline'],
  [0.5, 4.4, 0.5, -10.5, 2.2, -9.5, 'hairline'],
  [8.0, 0.7, 0.9, -14, 4.35, -12, 'accent'],
  [0.9, 0.7, 6.0, -14, 4.35, -12, 'hairline'],
  [0.7, 1.0, 0.7, -14, 3.5, -12, 'muted'],
  [1.4, 1.4, 1.4, -17, 0.7, -11, 'hairline'],
  [1.2, 1.2, 1.2, -17, 2.0, -11, 'surface'],
  [3.0, 1.1, 0.6, -11, 0.55, -8, 'hairline'],
  // Site B "TANK FARM" (14,-12): low walls + crates around the tanks.
  [3.0, 1.1, 0.6, 11, 0.55, -8, 'hairline'],
  [1.4, 0.9, 1.4, 17.5, 0.45, -8, 'hairline'],
  [4.0, 1.0, 0.6, 16, 0.5, -15.5, 'surface'],
  [1.2, 1.2, 1.2, 11, 0.6, -15.5, 'hairline'],
  // Mid lane: stacked containers + centre pillar + barriers.
  [4.2, 2.4, 1.4, -3, 1.2, -4, 'container'],
  [2.4, 1.2, 1.4, -3, 3.0, -4, 'rust'],
  [4.2, 2.4, 1.4, 3, 1.2, -2, 'container'],
  [1.2, 3.4, 1.2, 0, 1.7, 0, 'hairline'],
  [3.0, 1.1, 0.6, 0, 0.55, -7, 'hairline'],
  [1.2, 1.2, 1.2, -6, 0.6, 2, 'hairline'],
  [1.2, 1.2, 1.2, 6, 0.6, 2, 'hairline'],
  // West lane (to A).
  [1.6, 1.6, 1.6, -18, 0.8, -4, 'hairline'],
  [1.2, 1.2, 1.2, -18, 0.6, 0, 'surface'],
  [0.6, 1.1, 3.0, -12, 0.55, 4, 'hairline'],
  [1.0, 3.0, 1.0, -16, 1.5, 6, 'hairline'],
  [1.4, 0.9, 1.4, -8, 0.45, 8, 'hairline'],
  // East lane (to B).
  [1.6, 1.6, 1.6, 18, 0.8, -4, 'hairline'],
  [1.2, 1.2, 1.2, 18, 0.6, 0, 'surface'],
  [0.6, 1.1, 3.0, 12, 0.55, 4, 'hairline'],
  [1.0, 3.0, 1.0, 16, 1.5, 6, 'hairline'],
  [1.4, 0.9, 1.4, 8, 0.45, 8, 'hairline'],
  // South Gate (player spawn): raised platform + gate posts + barriers.
  [6.0, 0.5, 3.0, 0, 0.25, 6, 'surface'],
  [1.2, 1.2, 1.2, -4, 0.6, 10, 'hairline'],
  [1.2, 1.2, 1.2, 4, 0.6, 10, 'hairline'],
  [0.9, 2.2, 0.9, -4, 1.1, 16, 'hairline'],
  [0.9, 2.2, 0.9, 4, 1.1, 16, 'hairline'],
  [2.4, 0.9, 1.2, -8, 0.45, 12, 'hairline'],
  [2.4, 0.9, 1.2, 8, 0.45, 12, 'hairline'],
  // North Depot (foe spawn).
  [3.0, 1.1, 0.6, -6, 0.55, -16, 'hairline'],
  [3.0, 1.1, 0.6, 6, 0.55, -16, 'hairline'],
  [1.4, 1.4, 1.4, 6, 0.7, -16.5, 'surface'],
  // Scattered crates.
  [1.4, 1.4, 1.4, -9, 0.7, -12, 'surface'],
  [1.4, 1.4, 1.4, 9, 0.7, -12, 'surface'],
  [1.0, 1.0, 1.0, -2, 0.5, 12, 'hairline'],
  [1.0, 1.0, 1.0, 2, 0.5, 12, 'hairline'],
];

// [radius, height, x, z, material] — cylinders stand on the floor.
const CYLINDERS = [
  [1.6, 2.6, 11, -14.5, 'container'], // B tanks
  [1.6, 2.6, 17, -14, 'hairline'],
  [1.2, 2.0, 16, -9.5, 'rust'],
  [0.55, 1.1, -19.5, -16, 'muted'], // barrels
  [0.55, 1.1, 19.5, 12, 'muted'],
  [0.55, 1.1, -19.5, 12, 'hairline'],
];

const V3 = (x, z) => new THREE.Vector3(x, 0, z);

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  // [roughness, metalness] per palette key — bright playable surfaces,
  // low metalness (high metalness without an env map reads near-black).
  const FINISH = {
    canvas: [0.95, 0], surface: [0.85, 0.05], hairline: [0.65, 0.25],
    muted: [0.9, 0], accent: [0.55, 0.1], floor: [0.95, 0],
    container: [0.8, 0.1], rust: [0.8, 0.1], foe: [0.5, 0.2], ally: [0.5, 0.2],
  };
  for (const name of Object.keys(PALETTE)) {
    const f = FINISH[name] || [0.9, 0.03];
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: f[0],
      metalness: f[1],
    });
  }
  const geoCache = new Map();
  const boxGeo = (w, h, d) => {
    const k = `b${w}|${h}|${d}`;
    if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(k);
  };
  const cylGeo = (r, h) => {
    const k = `c${r}|${h}`;
    if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(r, r, h, 20));
    return geoCache.get(k);
  };

  const colliders = [];
  const shootables = [];
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
  };
  for (const [w, h, d, x, y, z, m] of BOXES) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), mats[m]);
    mesh.position.set(x, y, z);
    add(mesh);
  }
  for (const [r, h, x, z, m] of CYLINDERS) {
    const mesh = new THREE.Mesh(cylGeo(r, h), mats[m]);
    mesh.position.set(x, h / 2, z);
    add(mesh);
  }

  return {
    colliders,
    shootables,
    sites: {
      A: { pos: V3(-14, -12), radius: 3.2, label: 'CRANE BAY' },
      B: { pos: V3(14, -12), radius: 3.2, label: 'TANK FARM' },
    },
    spawns: {
      you: V3(0, 14),
      allies: [V3(-2, 14), V3(2, 14)],
      foes: [V3(-2, -15), V3(2, -15), V3(0, -16.5), V3(0, -13)],
    },
    routes: {
      // Foe spawn (0,-15) -> site, two approaches each.
      A: [
        [V3(0, -15), V3(-7, -15), V3(-12, -14), V3(-14, -12)],
        [V3(0, -15), V3(-5, -9), V3(-11, -9), V3(-14, -12)],
      ],
      B: [
        [V3(0, -15), V3(7, -15), V3(12, -14), V3(14, -12)],
        [V3(0, -15), V3(5, -9), V3(11, -9), V3(14, -12)],
      ],
    },
    cover: [
      V3(-12, -10), V3(-16, -14), V3(12, -10), V3(16, -14),
      V3(0, -6), V3(-7, 0), V3(7, 0), V3(-14, 2), V3(14, 2), V3(0, 8),
    ],
    bounds: { minX: -22, maxX: 22, minZ: -18, maxZ: 18 },
  };
}
