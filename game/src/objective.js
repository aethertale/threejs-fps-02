// objective.js — EMBERLINE plant / defuse objective (module C).
// Owns the bomb state machine + bomb visuals. Imports nothing from
// bots.js / round.js — it only sees plain numbers via ctx.
// Single advancement path: step() is the ONLY driver of plant/defuse
// progress (there used to be tryPlant/tryDefuse side doors; they let the
// plant flap and let defuse advance on proximity alone). main.js feeds
// step() the current input every tick (holdingPlant, playerAlive) and an
// eligibleDefuser() callback that names ONE foe allowed to defuse.
// Signature note: createObjective(map, scene) — scene is an optional
// second argument (contract lists only map); without it the state logic
// still works but no bomb mesh / site rings are built.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3; // seconds holding E inside a site
const DEFUSE_TIME = 5; // seconds the designated foe holds the bomb
const BOMB_TIME = 35; // seconds from plant to detonation

export function createObjective(map, scene) {
  const state = {
    status: 'idle', // idle | planting | planted | defusing | detonated | defused
    site: null, // 'A' | 'B' | null
    progress: 0, // 0..1 plant/defuse progress
    timer: 0, // seconds to detonation once planted (35)
  };

  // --- visuals: dark bomb box + amber blinking light + floor site rings ---
  let bombGroup = null;
  let bombLight = null;
  let bombLamp = null;
  const rings = {};
  if (scene) {
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.6, metalness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
    bombGroup = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.26), boxMat);
    box.position.y = 0.11;
    box.castShadow = true;
    bombLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampMat);
    bombLamp.position.set(0, 0.26, 0);
    bombLight = new THREE.PointLight(0xff9a2e, 0, 7, 1.6);
    bombLight.position.set(0, 0.4, 0);
    bombGroup.add(box, bombLamp, bombLight);
    bombGroup.visible = false;
    scene.add(bombGroup);

    const ringGeo = new THREE.RingGeometry(2.6, 3.2, 48);
    for (const key of ['A', 'B']) {
      const site = map.sites[key];
      const color = key === 'A' ? PALETTE.accent : PALETTE.ally;
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.pos.x, 0.03, site.pos.z);
      scene.add(ring);
      rings[key] = ring;
    }
  }

  let _ctx = null;
  let _site = null; // site the player is currently standing in ('A' | 'B' | null)
  let _blinkT = 0;
  let _defuser = null; // the ONE foe currently allowed to defuse (or null)

  function siteAt(pos) {
    if (!pos) return null;
    for (const key of ['A', 'B']) {
      const s = map.sites[key];
      const dx = pos.x - s.pos.x;
      const dz = pos.z - s.pos.z;
      if (dx * dx + dz * dz < s.radius * s.radius) return key;
    }
    return null;
  }

  function fire(name, arg) {
    if (_ctx && typeof _ctx[name] === 'function') _ctx[name](arg);
  }

  function placeBomb() {
    if (!bombGroup || !state.site) return;
    const s = map.sites[state.site];
    bombGroup.position.set(s.pos.x, 0, s.pos.z);
    bombGroup.visible = true;
  }

  function advancePlant(dt, siteKey) {
    // A plant can only start from idle/planting — never overwrite a live
    // bomb (planted/defusing) or a finished one.
    if (state.status !== 'idle' && state.status !== 'planting') return;
    if (siteKey) state.site = siteKey;
    state.status = 'planting';
    state.progress = Math.min(1, state.progress + dt / PLANT_TIME);
    if (state.progress >= 1) {
      state.status = 'planted';
      state.progress = 0; // plant and defuse share `progress` — reset it, or the
      // first defuse step completes instantly (progress is already 1)
      state.timer = BOMB_TIME;
      placeBomb();
      fire('onPlanted', state.site);
    }
  }

  function advanceDefuse(dt) {
    if (state.status !== 'planted' && state.status !== 'defusing') return;
    state.status = 'defusing';
    state.progress = Math.min(1, state.progress + dt / DEFUSE_TIME);
    if (state.progress >= 1) {
      state.status = 'defused';
      state.timer = 0;
      if (bombLight) bombLight.intensity = 0;
      fire('onDefused');
    }
  }

  return {
    state,

    step(dt, ctx) {
      _ctx = ctx || _ctx;
      if (!ctx) return;
      _site = siteAt(ctx.playerPos);

      if (ctx.phase !== 'live') {
        // planting only counts while the round is live; cancel a half-plant
        if (state.status === 'planting') { state.status = 'idle'; state.progress = 0; }
        return;
      }

      // Plant: driven only here, from this tick's real input. A dead player
      // cannot keep planting, and releasing E cancels the half-plant.
      if (state.status === 'idle' || state.status === 'planting') {
        if (ctx.holdingPlant && ctx.playerAlive && _site) advancePlant(dt, _site);
        else if (state.status === 'planting') { state.status = 'idle'; state.progress = 0; }
      }

      if (state.status === 'planted' || state.status === 'defusing') {
        // Defuse: exactly ONE eligible foe (alive, in 'defuse' state, in
        // range, with line of sight — the caller decides eligibility).
        // Proximity alone never advances it; an interruption or a change
        // of defuser resets progress to zero.
        const cand = (typeof ctx.eligibleDefuser === 'function') ? ctx.eligibleDefuser() : null;
        if (cand) {
          if (_defuser !== cand.bot) { _defuser = cand.bot; state.progress = 0; }
          advanceDefuse(dt);
        } else {
          _defuser = null;
          if (state.status === 'defusing') { state.status = 'planted'; state.progress = 0; }
        }
        if (state.status === 'planted' || state.status === 'defusing') {
          state.timer -= dt;
          _blinkT += dt;
          const on = Math.sin(_blinkT * 9) > 0;
          if (bombLight) bombLight.intensity = on ? 2.4 : 0.15;
          if (bombLamp) bombLamp.visible = on;
          if (state.timer <= 0) {
            state.timer = 0;
            state.status = 'detonated';
            if (bombLight) bombLight.intensity = 0;
            fire('onDetonated');
          }
        }
      }
    },

    reset() {
      state.status = 'idle';
      state.site = null;
      state.progress = 0;
      state.timer = 0;
      _site = null;
      _blinkT = 0;
      _defuser = null;
      if (bombGroup) bombGroup.visible = false;
      if (bombLight) bombLight.intensity = 0;
    },
  };
}
