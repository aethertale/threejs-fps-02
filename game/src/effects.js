// EMBERLINE — pooled hit effects. Tracers, impact sparks, explosions.
// Everything is preallocated; step() allocates nothing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const SPARKS = 16;
const BOOMS = 4;
const TRACER_LIFE = 0.06;
const SPARK_LIFE = 0.2;
const BOOM_LIFE = 0.5;

export function createEffects(scene) {
  const up = new THREE.Vector3(0, 0, 1);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // --- Tracers: thin stretched boxes, amber by default --------------------
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracers = [];
  const tracerAge = new Float32Array(TRACERS);
  let tracerNext = 0;
  for (let i = 0; i < TRACERS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(tracerGeo, mat);
    m.visible = false;
    scene.add(m);
    tracers.push(m);
    tracerAge[i] = TRACER_LIFE;
  }

  // --- Impact sparks: small additive sprites ------------------------------
  const sparkGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const sparks = [];
  const sparkAge = new Float32Array(SPARKS);
  let sparkNext = 0;
  for (let i = 0; i < SPARKS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc46b), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const m = new THREE.Mesh(sparkGeo, mat);
    m.visible = false;
    scene.add(m);
    sparks.push(m);
    sparkAge[i] = SPARK_LIFE;
  }

  // --- Explosions: expanding sphere + point light -------------------------
  const boomGeo = new THREE.SphereGeometry(1, 12, 8);
  const booms = [];
  const boomAge = new Float32Array(BOOMS);
  let boomNext = 0;
  for (let i = 0; i < BOOMS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const sphere = new THREE.Mesh(boomGeo, mat);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 12);
    const g = new THREE.Group();
    g.add(sphere);
    g.add(light);
    g.visible = false;
    scene.add(g);
    booms.push({ group: g, sphere, light, mat });
    boomAge[i] = BOOM_LIFE;
  }

  function tracer(from, to, color) {
    const i = tracerNext;
    tracerNext = (tracerNext + 1) % TRACERS;
    const m = tracers[i];
    if (color !== undefined) m.material.color.set(color);
    tmpA.addVectors(from, to).multiplyScalar(0.5);
    m.position.copy(tmpA);
    tmpB.subVectors(to, from);
    const len = Math.max(0.05, tmpB.length());
    m.scale.set(1, 1, len);
    m.lookAt(to);
    m.material.opacity = 0.9;
    m.visible = true;
    tracerAge[i] = 0;
  }

  function impact(point, normal) {
    const i = sparkNext;
    sparkNext = (sparkNext + 1) % SPARKS;
    const m = sparks[i];
    m.position.copy(point);
    tmpA.addVectors(point, normal);
    m.lookAt(tmpA);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.set(1, 1, 1);
    m.material.opacity = 1;
    m.visible = true;
    sparkAge[i] = 0;
  }

  function explosion(point) {
    const i = boomNext;
    boomNext = (boomNext + 1) % BOOMS;
    const b = booms[i];
    b.group.position.copy(point);
    b.group.scale.set(0.5, 0.5, 0.5);
    b.mat.opacity = 0.85;
    b.light.intensity = 60;
    b.group.visible = true;
    boomAge[i] = 0;
  }

  function step(dt) {
    for (let i = 0; i < TRACERS; i++) {
      if (tracerAge[i] >= TRACER_LIFE) continue;
      tracerAge[i] += dt;
      if (tracerAge[i] >= TRACER_LIFE) { tracers[i].visible = false; continue; }
      tracers[i].material.opacity = 0.9 * (1 - tracerAge[i] / TRACER_LIFE);
    }
    for (let i = 0; i < SPARKS; i++) {
      if (sparkAge[i] >= SPARK_LIFE) continue;
      sparkAge[i] += dt;
      if (sparkAge[i] >= SPARK_LIFE) { sparks[i].visible = false; continue; }
      const t = sparkAge[i] / SPARK_LIFE;
      sparks[i].material.opacity = 1 - t;
      const s = 1 - t * 0.6;
      sparks[i].scale.set(s, s, s);
    }
    for (let i = 0; i < BOOMS; i++) {
      if (boomAge[i] >= BOOM_LIFE) continue;
      boomAge[i] += dt;
      if (boomAge[i] >= BOOM_LIFE) { booms[i].group.visible = false; booms[i].light.intensity = 0; continue; }
      const t = boomAge[i] / BOOM_LIFE;
      const r = 0.5 + t * 5.5;
      booms[i].group.scale.set(r, r, r);
      booms[i].mat.opacity = 0.85 * (1 - t);
      booms[i].light.intensity = 60 * (1 - t);
    }
  }

  return { tracer, impact, explosion, step };
}
