// EMBERLINE — arsenal. Weapon defs, box-built view models, fire/reload/switch.
// main.js owns the raycast and the damage application; this module owns the
// numbers, the ammo, the view model animation and the muzzle position.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  rifle:   { name: 'HARRIER-7', price: 0,   mag: 30, reserve: 90, gap: 0.096, reload: 1.9, torso: 34, head: 100, spreadStill: 0.0022, spreadMove: 0.028, auto: true },
  shotgun: { name: 'BREACH-12', price: 600, mag: 6,  reserve: 24, gap: 0.85,  reload: 2.6, torso: 12, head: 24,  pellets: 8, spreadStill: 0.02,   spreadMove: 0.035, auto: false },
  smg:     { name: 'VIPER-9', price: 900, mag: 32, reserve: 96, gap: 0.055, reload: 2.0, torso: 20, head: 55, spreadStill: 0.006, spreadMove: 0.032, auto: true },
};

const FLASH_TIME = 0.06;
const MOVE_REF = 5.2;
const KICK_MAX = 0.055;
const VM_POS = { x: 0.26, y: -0.23, z: -0.48 }; // view-model anchor on the camera

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildRifle(dark, mid, accent) {
  const g = new THREE.Group();
  g.add(box(0.09, 0.1, 0.42, mid, 0, 0, 0));            // receiver
  g.add(box(0.045, 0.045, 0.42, dark, 0, 0.025, -0.4)); // barrel
  g.add(box(0.075, 0.08, 0.22, dark, 0, -0.02, 0.3));   // stock
  g.add(box(0.05, 0.09, 0.1, dark, 0, -0.09, 0.08));    // grip
  g.add(box(0.02, 0.05, 0.16, accent, 0, 0.075, -0.18));// sight rail
  g.add(box(0.06, 0.12, 0.08, dark, 0, -0.08, -0.12));  // foregrip
  g.scale.setScalar(0.8); // keep the rifle out of the centre of the frame
  g.position.set(VM_POS.x, VM_POS.y, VM_POS.z);
  return g;
}

function buildShotgun(dark, mid, accent) {
  const g = new THREE.Group();
  g.add(box(0.1, 0.11, 0.4, mid, 0, 0, 0));             // receiver
  g.add(box(0.055, 0.055, 0.52, dark, 0, 0.03, -0.44)); // barrel
  g.add(box(0.06, 0.06, 0.3, accent, 0, -0.03, -0.36));// pump slide
  g.add(box(0.08, 0.09, 0.24, dark, 0, -0.02, 0.3));    // stock
  g.add(box(0.05, 0.09, 0.1, dark, 0, -0.095, 0.06));   // grip
  g.add(box(0.03, 0.04, 0.1, accent, 0, 0.08, -0.1));   // bead sight
  g.scale.setScalar(0.8); // keep the shotgun out of the centre of the frame
  g.position.set(VM_POS.x, VM_POS.y, VM_POS.z);
  return g;
}

function buildSmg(dark, mid, accent) {
  const g = new THREE.Group();
  g.add(box(0.08, 0.09, 0.26, mid, 0, 0, 0));            // compact receiver
  g.add(box(0.04, 0.04, 0.22, dark, 0, 0.02, -0.22));    // short barrel
  g.add(box(0.05, 0.06, 0.06, accent, 0, 0.02, -0.32));  // muzzle tip
  g.add(box(0.045, 0.16, 0.07, dark, 0.03, -0.11, -0.02)); // side magazine
  g.add(box(0.06, 0.07, 0.14, dark, 0, -0.02, 0.18));    // stock
  g.add(box(0.045, 0.08, 0.08, dark, 0, -0.08, 0.05));   // grip
  g.add(box(0.02, 0.04, 0.12, accent, 0, 0.065, -0.08)); // sight rail
  g.scale.setScalar(0.8); // keep the SMG out of the centre of the frame
  g.position.set(VM_POS.x, VM_POS.y, VM_POS.z);
  return g;
}

export function createArsenal(camera) {
  // View-model metals: explicit greys (the palette's ink is near-white and
  // hairline is structural steel — neither is a gunmetal).
  const dark = new THREE.MeshStandardMaterial({ color: 0x303b44, roughness: 0.7, metalness: 0.2 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x58636c, roughness: 0.5, metalness: 0.25 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });

  const rifleModel = buildRifle(dark, mid, accent);
  const shotgunModel = buildShotgun(dark, mid, accent);
  const smgModel = buildSmg(dark, mid, accent);
  shotgunModel.visible = false;
  smgModel.visible = false;
  camera.add(rifleModel);
  camera.add(shotgunModel);
  camera.add(smgModel);

  // Shared muzzle flash: one plane + one light, re-aimed per weapon.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  camera.add(flashLight);

  const ammo = {
    rifle: { mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve },
    shotgun: { mag: WEAPONS.shotgun.mag, reserve: WEAPONS.shotgun.reserve },
    smg: { mag: WEAPONS.smg.mag, reserve: WEAPONS.smg.reserve },
  };
  const state = { mag: ammo.rifle.mag, reserve: ammo.rifle.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  const muzzleWorld = new THREE.Vector3();
  const muzzleLocal = new THREE.Vector3();
  const arsenal = {
    current: 'rifle',
    state,
    grenades: 0,
  };

  function def() { return WEAPONS[arsenal.current]; }
  function model() {
    if (arsenal.current === 'rifle') return rifleModel;
    if (arsenal.current === 'shotgun') return shotgunModel;
    return smgModel;
  }
  function muzzleOffset() {
    // Muzzle tip in camera space; shotgun barrel is longest, SMG shortest.
    if (arsenal.current === 'rifle') return muzzleLocal.set(VM_POS.x, VM_POS.y + 0.02, VM_POS.z - 0.62);
    if (arsenal.current === 'shotgun') return muzzleLocal.set(VM_POS.x, VM_POS.y + 0.03, VM_POS.z - 0.72);
    return muzzleLocal.set(VM_POS.x, VM_POS.y + 0.02, VM_POS.z - 0.52);
  }

  arsenal.getMuzzle = function () {
    // Returns a REUSED temp Vector3 (world space). Copy it if you keep it.
    muzzleOffset();
    return muzzleWorld.copy(muzzleLocal).applyMatrix4(camera.matrixWorld);
  };

  arsenal.step = function (dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const m = model();
    m.position.z = VM_POS.z + state.kick;
    m.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const dip = Math.sin(Math.min(1, (def().reload - state.reloadLeft) / def().reload) * Math.PI);
      m.rotation.x = -0.55 * dip;
      m.position.y = VM_POS.y - 0.12 * dip;
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    } else {
      m.position.y = VM_POS.y;
    }
    const on = state.flash > 0;
    flash.visible = on;
    if (on) {
      muzzleOffset();
      flash.position.copy(muzzleLocal);
      flash.rotation.z = state.flash * 40;
      flashLight.position.set(muzzleLocal.x, muzzleLocal.y, muzzleLocal.z + 0.3);
      flashLight.intensity = 18;
    } else {
      flashLight.intensity = 0;
    }
  };

  arsenal.ready = function () {
    return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
  };

  arsenal.pullTrigger = function () {
    state.cooldown = def().gap;
    state.flash = FLASH_TIME;
    state.kick = KICK_MAX;
  };

  arsenal.takeRound = function () {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  };

  arsenal.reload = function () {
    if (state.reloadLeft > 0 || state.mag === def().mag || state.reserve === 0) return;
    state.reloadLeft = def().reload;
  };

  arsenal.refill = function () {
    for (const k of ['rifle', 'shotgun', 'smg']) {
      ammo[k].mag = WEAPONS[k].mag;
      ammo[k].reserve = WEAPONS[k].reserve;
    }
    state.mag = ammo[arsenal.current].mag;
    state.reserve = ammo[arsenal.current].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
  };

  arsenal.switchTo = function (name) {
    if (name !== 'rifle' && name !== 'shotgun' && name !== 'smg') return false;
    if (name === arsenal.current) return false;
    ammo[arsenal.current].mag = state.mag;
    ammo[arsenal.current].reserve = state.reserve;
    arsenal.current = name;
    state.mag = ammo[name].mag;
    state.reserve = ammo[name].reserve;
    // Switching keeps the cooldown: clearing it here lets a rapid switch
    // bypass weapon recovery (fire the rifle, switch, switch back, fire).
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    rifleModel.visible = name === 'rifle';
    shotgunModel.visible = name === 'shotgun';
    smgModel.visible = name === 'smg';
    return true;
  };

  arsenal.spread = function (speed) {
    const d = def();
    return d.spreadStill + Math.min(1, speed / MOVE_REF) * d.spreadMove;
  };

  arsenal.damage = function (part) {
    const d = def();
    if (part === 'head') return d.head;
    if (part === 'legs') return Math.round(d.torso * 0.7);
    return d.torso;
  };

  arsenal.isShotgun = function () { return arsenal.current === 'shotgun'; };

  // Pellet interface for main.js: one raycast per pellet. WEAPONS.shotgun.pellets
  // is the count (8); pelletCount() mirrors it, and spread() already returns the
  // per-pellet cone for the current weapon. Each pellet deals damage('torso'|'head').
  arsenal.pelletCount = function () {
    return arsenal.isShotgun() ? WEAPONS.shotgun.pellets : 1;
  };

  arsenal.hasGrenade = function () { return arsenal.grenades > 0; };

  arsenal.throwGrenade = function () {
    if (arsenal.grenades <= 0) return false;
    arsenal.grenades -= 1;
    return true;
  };

  return arsenal;
}
