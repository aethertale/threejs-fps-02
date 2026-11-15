// EMBERLINE — player movement. Axis-separated AABB slide vs Box3 colliders.
// Feet-based position; the mover is shared by the player and by bots.
import * as THREE from 'three';

const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const MAX_FALL = 30;
const LIFT = 0.04; // horizontal probes ignore this much of the floor/crown

export function createMover(colliders, radius, height) {
  const standHeight = height;
  const crouchHeight = Math.max(0.6, height - 0.6);
  const probe = new THREE.Box3();
  const mover = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    onGround: false,
    crouching: false,
    height,
    radius,
  };

  function hits(x, y, z, h, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + h - lift, z + radius);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  mover.setCrouch = function (want) {
    if (want === mover.crouching) return true;
    if (want) {
      mover.crouching = true;
      mover.height = crouchHeight;
      return true;
    }
    // Standing up needs headroom for the full body.
    if (hits(mover.position.x, mover.position.y, mover.position.z, standHeight, 0.02)) return false;
    mover.crouching = false;
    mover.height = standHeight;
    return true;
  };

  mover.jump = function () {
    if (!mover.onGround) return false;
    mover.velocity.y = JUMP_SPEED;
    mover.onGround = false;
    return true;
  };

  // wishX/wishZ: world-space wish direction (normalized by caller or here).
  mover.move = function (dt, wishX, wishZ, speed, accel) {
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 1) { wishX /= wl; wishZ /= wl; }
    const blend = Math.min(1, (accel * dt) / Math.max(0.01, speed));
    mover.velocity.x += (wishX * speed - mover.velocity.x) * blend;
    mover.velocity.z += (wishZ * speed - mover.velocity.z) * blend;
    if (mover.onGround && wl < 0.01) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      mover.velocity.x *= damp;
      mover.velocity.z *= damp;
    }
    mover.velocity.y -= GRAVITY * dt;
    if (mover.velocity.y < -MAX_FALL) mover.velocity.y = -MAX_FALL;

    const p = mover.position;
    const v = mover.velocity;
    const h = mover.height;
    let nx = p.x + v.x * dt;
    if (!hits(nx, p.y, p.z, h, LIFT)) p.x = nx; else v.x = 0;
    let nz = p.z + v.z * dt;
    if (!hits(p.x, p.y, nz, h, LIFT)) p.z = nz; else v.z = 0;

    p.y += v.y * dt;
    mover.onGround = false;
    const hit = hits(p.x, p.y, p.z, h, 0);
    if (hit) {
      if (v.y <= 0) { p.y = hit.max.y; v.y = 0; mover.onGround = true; }
      else { p.y = hit.min.y - h; v.y = 0; }
    }
    if (p.y < 0) { p.y = 0; v.y = 0; mover.onGround = true; }
  };

  return mover;
}

export function createPlayer(colliders) {
  const mover = createMover(colliders, 0.34, STAND_HEIGHT);
  mover.position.set(0, 0, 14);
  mover.onGround = true;
  const state = {
    position: mover.position,
    velocity: mover.velocity,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const tmpWish = { x: 0, z: 0 };

  function look(dx, dy, sensitivity) {
    const s = sensitivity === undefined ? 0.0022 : sensitivity;
    state.yaw -= dx * s;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * s));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    mover.setCrouch(wantCrouch);
    state.crouching = mover.crouching;
    state.height = mover.height;
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    tmpWish.x = -sin * fwd + cos * str;
    tmpWish.z = -cos * fwd - sin * str;

    const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = mover.onGround ? GROUND_ACCEL : AIR_ACCEL;
    mover.move(dt, tmpWish.x, tmpWish.z, speed, accel);
    if (keys.has('Space')) mover.jump();
    state.onGround = mover.onGround;
  }

  return {
    state,
    mover,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
