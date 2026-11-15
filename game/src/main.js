// EMBERLINE: boot + fixed-step loop + shooting + grenades + ?shot= captures.
// Wiring hub — the only module importing everything. Temps reused, no hot-loop allocation.
import * as THREE from 'three';
import { createStage, syncCamera } from './render.js';
import { createMap } from './map.js';
import { createState } from './state.js';
import { createPlayer } from './player.js';
import { WEAPONS, createArsenal } from './weapons.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createObjective } from './objective.js';
import { createRound } from './round.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = parseInt(params.get('seed') || '1', 10) || 1;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : Math.random;
const { renderer, scene, camera } = createStage();
const map = createMap(scene);
const state = createState();
const player = createPlayer(map.colliders);
const arsenal = createArsenal(camera);
const effects = createEffects(scene);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const ray = new THREE.Raycaster(); ray.far = 90;
const losRay = new THREE.Raycaster();
const _dir = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _g2 = new THREE.Vector3();
let shakeT = 0, frozen = false, matchOver = false, suppressPause = false;
let buyMenuOpen = false, plantAwarded = false, lastTimer = -1, wasFiring = false;
let paused = false, grenadeQueued = false, shotPlantHold = false;

function los(from, to) { // LOS for bots: true when no solid mesh sits between the points
  _v1.copy(to).sub(from);
  const d = _v1.length();
  if (d < 0.001) return true;
  losRay.set(from, _v1.normalize()); losRay.far = d;
  return losRay.intersectObjects(map.shootables, false).length === 0;
}
function damagePlayer(amount) {
  if (!state.playerAlive || state.phase !== 'live') return;
  if (state.owned.armor || state.playerArmor > 0) amount *= 0.5;
  state.playerHealth = Math.max(0, state.playerHealth - amount);
  hud.setHealth(state.playerHealth, state.playerArmor);
  hud.damageFlash(); shakeT = 0.25;
  if (state.playerHealth <= 0) {
    state.playerAlive = false; state.deaths += 1;
    hud.feed('YOU ARE DOWN — ALLIES FIGHTING');
    hud.showOverlay('down');
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
const bots = createBots(scene, map, {
  los, random: rng,
  onShootBot(bot, targetPos) {
    if (bot.torso) bot.torso.getWorldPosition(_v1);
    else _v1.set(bot.group.position.x, bot.group.position.y + 1.35, bot.group.position.z);
    effects.tracer(_v1, targetPos, bot.team === 'foe' ? 0xc4452a : 0x2e8f86);
  },
  onDamagePlayer(amount) { damagePlayer(amount); },
  // Kill credit lives here, exactly once per kill: the player's own gun/grenade
  // (killerTeam 'player', from bots.damage) credits kills + $150; an ally's
  // kill (killerTeam 'you', from bot-vs-bot shootAt) only feeds the feed.
  onKill(victim, killerTeam) {
    if (victim.team === 'foe' && killerTeam === 'player') onPlayerKill();
    else hud.feed((victim.team === 'foe' ? 'WARDEN' : 'VANGUARD') + ' DOWN');
  },
});
const shootables = map.shootables.concat(bots.hitMeshes);
const objective = createObjective(map, scene); // scene arg builds bomb mesh + site rings
const round = createRound(state);
const nadePool = [];
{ // 2 pooled grenade spheres: ballistic arc, 2.5 s fuse
  const geo = new THREE.SphereGeometry(0.09, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff9a2e });
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false; scene.add(mesh);
    nadePool.push({ mesh, vel: new THREE.Vector3(), fuse: 0, ground: 0, live: false });
  }
}
function onPlayerKill() {
  if (round.addKill) round.addKill();
  else { state.kills += 1; state.money += 150; }
  hud.setMoney(state.money); hud.setKills(state.kills);
  hud.feed('WARDEN DOWN  +$150');
}
function explodeNade(n) {
  n.live = false; n.mesh.visible = false;
  _v1.copy(n.mesh.position); effects.explosion(_v1); shakeT = 0.4;
  for (const b of bots.list) {
    if (!b.alive) continue;
    _v2.copy(b.group.position); _v2.y += 1.1;
    const d = _v2.distanceTo(n.mesh.position);
    if (d < 6) {
      // Grenades respect walls: no damage without line of sight.
      _g2.copy(_v2);
      if (!los(n.mesh.position, _g2)) continue;
      bots.damage(b.torso, Math.round(100 - (80 * d) / 6), 'torso'); // credit via ctx onKill
    }
  }
  if (state.playerAlive) {
    _v2.copy(player.state.position); _v2.y += 1.2;
    const dp = _v2.distanceTo(n.mesh.position);
    if (dp < 6) {
      _g2.copy(_v2);
      if (los(n.mesh.position, _g2)) damagePlayer(Math.round(100 - (80 * dp) / 6));
    }
  }
}
function throwGrenade() {
  const n = nadePool.find((g) => !g.live);
  if (!n) return;
  let ok = false;
  if (arsenal.hasGrenade && arsenal.throwGrenade) {
    ok = arsenal.hasGrenade();
    if (ok) arsenal.throwGrenade();
  } else if ((arsenal.grenades | 0) > 0) { arsenal.grenades -= 1; ok = true; }
  if (!ok) return;
  if (typeof arsenal.grenades === 'number') state.owned.grenades = arsenal.grenades;
  else state.owned.grenades = Math.max(0, state.owned.grenades - 1);
  camera.getWorldDirection(_dir);
  n.mesh.position.copy(camera.position);
  n.vel.copy(_dir).multiplyScalar(15); n.vel.y += 4.5;
  n.fuse = 2.5; n.ground = 0; n.live = true; n.mesh.visible = true;
}
function fireOnce() { // hitscan raycast with spread; tracer, impact or bot damage
  if (!arsenal.takeRound()) { arsenal.reload(); return false; }
  const def = WEAPONS[arsenal.current] || WEAPONS.rifle;
  const pellets = arsenal.pelletCount ? arsenal.pelletCount() : (arsenal.pellets ?? def.pellets ?? 8);
  // Airborne shooting is sloppy: horizontal speed alone understates spread
  // for a jumping stationary player.
  const spread = arsenal.spread(player.groundSpeed() + (player.state.onGround ? 0 : 2));
  let anyHit = false, killed = false;
  const muzzle = arsenal.getMuzzle ? arsenal.getMuzzle() : null;
  const from = muzzle && muzzle.isVector3 ? muzzle : camera.position;
  for (let p = 0; p < pellets; p++) {
    camera.getWorldDirection(_dir);
    _dir.x += (rng() * 2 - 1) * spread; _dir.y += (rng() * 2 - 1) * spread; _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    ray.set(camera.position, _dir);
    scene.updateMatrixWorld(true);
    const hits = ray.intersectObjects(shootables, false);
    // First VALID hit: a dead bot's meshes must neither block bullets nor
    // produce hitmarkers. Legs count as torso hits.
    let h = null;
    for (let i = 0; i < hits.length; i++) {
      const ud = hits[i].object.userData || {};
      if (ud.bot && !ud.bot.alive) continue;
      h = hits[i];
      break;
    }
    const end = h ? h.point : _v1.copy(camera.position).addScaledVector(_dir, 60);
    effects.tracer(from, end, 0xff9a2e);
    if (!h) continue;
    const ud = h.object.userData || {};
    if (ud.bot) {
      const res = bots.damage(h.object, arsenal.damage(ud.part || 'torso'), ud.part || 'torso', player.state.position);
      anyHit = true;
      if (res && res.killed) killed = true; // credit flows via ctx onKill, not here
    } else {
      if (h.face) _v2.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      else _v2.copy(_dir).negate();
      effects.impact(h.point, _v2);
    }
  }
  if (anyHit) hud.hitMarker(killed, shot ? 4000 : 90);
  arsenal.pullTrigger();
  // Gunfire is audible: nearby foes investigate the shooter's position.
  if (bots.hearShot) bots.hearShot(player.state.position.x, player.state.position.z);
  player.recoil(0.011 + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, def.name);
  return true;
}
function onPlanted(site) {
  if (plantAwarded) return;
  plantAwarded = true;
  if (round.addPlant) round.addPlant(); else state.money += 300;
  hud.setMoney(state.money);
  hud.setObjective('BOMB PLANTED — DEFEND THE SITE');
  hud.feed('CHARGE PLANTED — SITE ' + site + '  +$300');
  hud.setCaption(''); hud.setPlant(null);
}
function eligibleDefuser() {
  // The ONE foe allowed to defuse: alive, committed to the 'defuse'
  // state, within 2 m, with line of sight to the bomb. Proximity alone
  // never qualifies — a foe shooting, behind cover, or mid-rotation
  // does not advance the defuse.
  if (!state.bomb.site) return null;
  const bp = map.sites[state.bomb.site].pos;
  let best = null, bd = 1e9;
  for (const b of bots.list) {
    if (!b.alive || b.team !== 'foe' || b.state !== 'defuse') continue;
    const d = b.group.position.distanceTo(bp);
    if (d >= 2 || d >= bd) continue;
    _e1.set(b.group.position.x, 1.5, b.group.position.z);
    _e2.set(bp.x, 0.2, bp.z);
    if (!los(_e1, _e2)) continue;
    bd = d; best = b;
  }
  return best ? { bot: best, dist: bd } : null;
}
function plantStep(dt) {
  // HUD mirror only. Planting itself is driven by objective.step() from
  // this tick's real input (see step(): holdingPlant) — there is no
  // second advancement path any more.
  if (state.bomb.status === 'planting') {
    hud.setPlant(state.bomb.progress);
    hud.setCaption('HOLD E — PLANTING ' + Math.round(state.bomb.progress * 100) + '%');
  } else {
    hud.setPlant(null);
    if (!shot) hud.setCaption('');
  }
}
function onPhase(phase) {
  if (phase === 'buy') {
    buyMenuOpen = true; hud.showBuy(true, state);
    hud.hideOverlay(); // clears a stale round overlay if the round auto-advanced
    hud.setObjective('BUY PHASE — PRESS B FOR LOADOUT'); hud.setCaption('');
  } else if (phase === 'live') {
    buyMenuOpen = false; hud.showBuy(false, state);
    hud.setObjective('PLANT THE CHARGE — A CRANE BAY OR B TANK FARM');
  } else if (phase === 'end') hud.showBuy(false, state);
  refreshHud();
}
function onRoundEnd(result) {
  state.result = result;
  if (state.matchWinner) { onMatchEnd(state.matchWinner); return; }
  suppressPause = true;
  hud.showOverlay('round', result);
  hud.setScore(state.score.you, state.score.foe, state.round);
  hud.setMoney(state.money);
  if (document.pointerLockElement) document.exitPointerLock();
}
function onMatchEnd(winner) {
  state.matchWinner = winner; matchOver = true; suppressPause = true;
  hud.showOverlay('match', { winner, win: winner === 'you' });
  if (document.pointerLockElement) document.exitPointerLock();
}
const objCtx = {
  phase: 'buy', playerPos: player.state.position, playerAlive: true, holdingPlant: false,
  foesAlive: 0, eligibleDefuser, onPlanted,
  onDetonated() { hud.feed('CHARGE DETONATED — SITE LOST'); hud.setObjective('CHARGE DETONATED'); },
  onDefused() { hud.feed('CHARGE DEFUSED — WARDENS HOLD'); hud.setObjective('CHARGE DEFUSED'); },
};
const roundCtx = {
  foesAlive: 0, alliesAlive: 0, playerAlive: true, bombStatus: 'idle',
  onRoundEnd, onMatchEnd, onPhase, onNextRound: advanceRound,
};
function refreshHud() {
  hud.setHealth(state.playerHealth, state.playerArmor);
  const def = WEAPONS[arsenal.current] || WEAPONS.rifle;
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, def.name);
  hud.setMoney(state.money);
  hud.setScore(state.score.you, state.score.foe, state.round);
  hud.setKills(state.kills);
  hud.setTimer(state.timer, state.phase);
}
function resetAll() {
  bots.reset(); objective.reset(); plantAwarded = false;
  player.state.position.copy(map.spawns.you);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0; player.state.pitch = 0;
  state.playerHealth = 100; state.playerAlive = true;
  arsenal.refill();
  if (typeof arsenal.grenades === 'number') arsenal.grenades = state.owned.grenades;
  for (const n of nadePool) { n.live = false; n.mesh.visible = false; }
  hud.hideOverlay();
  hud.showBuy(state.phase === 'buy', state);
  hud.setPlant(null); hud.setBombTimer(null);
  refreshHud();
}
// ONE round-start path: automatic advance (round.step end timer) and the
// manual NEXT ROUND button both run nextRound + resetAll, exactly once.
// nextRound alone only clears round fields — without resetAll, dead bots
// stay dead, positions/ammo persist, and stale objective state overwrites
// the fresh bomb state on the next tick.
function advanceRound() {
  round.nextRound();
  resetAll();
}
// Match restart: owned equipment is cleared by resetMatch, and the
// player's armor + weapon selection must go with it — otherwise a
// previously armored shotgun user restarts with an unowned shotgun and
// damage reduction. Round-to-round, armor and weapon persist.
function resetMatchAll() {
  round.resetMatch();
  state.playerArmor = 0;
  if (arsenal.current !== 'rifle') arsenal.switchTo('rifle');
  resetAll();
}
function buyItem(item) {
  if (state.phase !== 'buy' || !round.buy(item)) return;
  if (item === 'grenade' && typeof arsenal.grenades === 'number') arsenal.grenades = state.owned.grenades;
  if (item === 'armor') state.playerArmor = 100;
  if (item === 'ammo') arsenal.refill();
  if (item === 'shotgun') arsenal.switchTo('shotgun');
  hud.showBuy(true, state); refreshHud();
}
hud.onPlay(() => {
  if (matchOver) { matchOver = false; resetMatchAll(); }
  input.requestLock();
});
hud.onBuy((item) => buyItem(item));
hud.onNextRound(() => { advanceRound(); input.requestLock(); });
renderer.domElement.addEventListener('click', () => {
  if (!shot && !input.state.locked && state.phase !== 'end' && !state.matchWinner) input.requestLock();
});
function onLockChange(locked) {
  if (shot) return;
  if (locked) { paused = false; hud.hideOverlay(); }
  else {
    if (suppressPause) { suppressPause = false; return; }
    // Pause is real: losing the lock mid-round freezes the sim, it does
    // not just show an overlay over a running game.
    if (state.phase === 'live' && state.playerAlive && !state.matchWinner) {
      paused = true; hud.showOverlay('paused');
    }
  }
}
function nadeBlocked(x, y, z) {
  // Grenade flight respects walls: a point test vs solid colliders
  // (the floor's Box3 max.y is ~0, so the 0.05 threshold excludes it).
  for (let i = 0; i < map.colliders.length; i++) {
    const c = map.colliders[i];
    if (c.max.y <= 0.05) continue;
    if (x > c.min.x - 0.09 && x < c.max.x + 0.09 &&
        z > c.min.z - 0.09 && z < c.max.z + 0.09 &&
        y > c.min.y - 0.09 && y < c.max.y) return true;
  }
  return false;
}
function step(dt) {
  // Movement is gated: never while dead, never in end/match phases, never
  // while paused. (Buy-phase movement stays allowed.)
  if (!paused && state.playerAlive && (state.phase === 'live' || state.phase === 'buy')) {
    player.step(dt, input.state.keys);
  }
  arsenal.step(dt); effects.step(dt);
  bots.step(dt, {
    playerPos: player.state.position, playerAlive: state.playerAlive,
    bombStatus: state.bomb.status,
    bombPos: state.bomb.site ? map.sites[state.bomb.site].pos : null,
    phase: state.phase,
  });
  // Single authoritative objective update, from this tick's real input,
  // BEFORE the round is resolved — so a plant completing on the deadline
  // tick counts, and a final grenade kill can still win the round.
  objCtx.phase = state.phase; objCtx.playerAlive = state.playerAlive;
  objCtx.holdingPlant = state.phase === 'live' && state.playerAlive &&
    (input.state.keys.has('KeyE') || shotPlantHold);
  objCtx.foesAlive = bots.alive('foe');
  objective.step(dt, objCtx);
  // objective owns its own bomb state object; mirror it into state.bomb
  // (round + HUD read state.bomb).
  state.bomb.status = objective.state.status;
  state.bomb.site = objective.state.site;
  state.bomb.progress = objective.state.progress;
  state.bomb.timer = objective.state.timer;
  // Grenades: the throw command is queued in frame() and consumed here,
  // inside the fixed step — never once per rendered frame.
  if (grenadeQueued) {
    grenadeQueued = false;
    if (state.phase === 'live' && state.playerAlive) throwGrenade();
  }
  for (const n of nadePool) {
    if (!n.live) continue;
    n.vel.y -= 14 * dt;
    const np = n.mesh.position;
    let nx = np.x + n.vel.x * dt;
    if (!nadeBlocked(nx, np.y, np.z)) np.x = nx; else n.vel.x *= -0.4;
    let nz = np.z + n.vel.z * dt;
    if (!nadeBlocked(np.x, np.y, nz)) np.z = nz; else n.vel.z *= -0.4;
    let ny = np.y + n.vel.y * dt;
    if (ny > 0.09 && nadeBlocked(np.x, ny, np.z)) n.vel.y *= -0.35;
    else np.y = ny;
    if (np.y <= 0.09) {
      np.y = 0.09;
      n.vel.multiplyScalar(0.4); n.vel.y = Math.abs(n.vel.y) * 0.3;
      n.ground += dt;
      if (n.ground > 0.4) { explodeNade(n); continue; }
    }
    n.fuse -= dt;
    if (n.fuse <= 0) explodeNade(n);
  }
  // Firing is consumed inside the fixed step, after the current aim
  // transform is established (frame() syncs the camera before the step
  // loop) — never once per rendered frame on the previous camera pose,
  // so rifle cadence is frame-rate independent.
  if (state.phase === 'live' && state.playerAlive && !paused && input.state.locked && arsenal.ready()) {
    const def = WEAPONS[arsenal.current] || WEAPONS.rifle;
    const edge = input.state.firing && !wasFiring;
    wasFiring = input.state.firing;
    if (def.auto ? input.state.firing : edge) fireOnce();
  } else {
    wasFiring = input.state.firing;
  }
  plantStep(dt);
  roundCtx.foesAlive = bots.alive('foe'); roundCtx.alliesAlive = bots.alive('you');
  roundCtx.playerAlive = state.playerAlive; roundCtx.bombStatus = state.bomb.status;
  round.step(dt, roundCtx);
  if (state.bomb.status === 'planted' || state.bomb.status === 'defusing') {
    hud.setBombTimer(Math.max(0, Math.ceil(state.bomb.timer)));
  } else hud.setBombTimer(null);
  if (shakeT > 0) shakeT -= dt;
}
function frameSyncCamera() {
  syncCamera(camera, player.state);
  if (shakeT > 0) {
    camera.position.x += (rng() * 2 - 1) * 0.05 * shakeT * 4;
    camera.position.y += (rng() * 2 - 1) * 0.05 * shakeT * 4;
    camera.rotation.z += (rng() * 2 - 1) * 0.01 * shakeT * 4;
  }
}
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (frozen || paused) { renderer.render(scene, camera); return; }
  const look = input.takeLook();
  player.look(look.x, look.y);
  if (input.pressed('KeyR')) arsenal.reload();
  if (input.pressed('KeyG')) grenadeQueued = true; // consumed in step()
  if (input.pressed('Digit1')) {
    if (state.phase === 'buy') buyItem('shotgun'); else arsenal.switchTo('rifle');
  }
  if (input.pressed('Digit2')) {
    if (state.phase === 'buy') buyItem('grenade');
    else if (state.owned.shotgun) arsenal.switchTo('shotgun');
  }
  if (input.pressed('Digit3') && state.phase === 'buy') buyItem('armor');
  if (input.pressed('Digit4') && state.phase === 'buy') buyItem('ammo');
  if (input.pressed('KeyB') && state.phase === 'buy') {
    buyMenuOpen = !buyMenuOpen; hud.showBuy(buyMenuOpen, state);
  }
  if (input.pressed('Enter') && state.phase === 'buy') round.skipBuy();
  hud.setSpread(4 + arsenal.spread(player.groundSpeed()) * 300);
  hud.setHealth(state.playerHealth, state.playerArmor);
  const def = WEAPONS[arsenal.current] || WEAPONS.rifle;
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, def.name);
  hud.setMoney(state.money);
  hud.setScore(state.score.you, state.score.foe, state.round);
  const tSec = Math.max(0, Math.ceil(state.timer));
  if (tSec !== lastTimer) { lastTimer = tSec; hud.setTimer(tSec, state.phase); }
  // Establish the current aim transform BEFORE the fixed steps, so firing
  // consumed inside step() uses this frame's camera pose, not the last one.
  frameSyncCamera();
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n++; }
  if (acc > STEP * 5) acc = 0;
  frameSyncCamera();
  renderer.render(scene, camera);
}
// ---- ?shot= deterministic captures: settle, frame, render twice, freeze ----
// Every capture is driven by the REAL simulation: the combat shot earns its
// kill through fireOnce, the plant shot holds E in the site until the real
// objective reaches ~62%, and the result shot wins a real round. Nothing is
// written straight into state.bomb / state.result / the score.
function aimAt(x, y, z) {
  const p = player.state.position;
  // Eye height lives on player.state, NOT on position (a Vector3 has no .eye — using
  // p.eye here once produced NaN pitch and a black frame).
  const dx = x - p.x, dy = y - (p.y + player.state.eye), dz = z - p.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  frameSyncCamera();
}
function placeBot(b, x, z) {
  if (!b) return;
  b.group.position.set(x, 0, z); b.state = 'hold';
}
function settle(n) { for (let i = 0; i < n; i++) step(STEP); }
function paintTwiceThenReady() {
  let painted = 0;
  (function paint() {
    frameSyncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) { window.__shotReady = true; frozen = true; return; }
    requestAnimationFrame(paint);
  })();
}
function runShot(name) {
  hud.hideOverlay(); hud.showBuy(false, state);
  resetMatchAll();
  const foes = bots.list.filter((b) => b.team === 'foe');
  if (name === 'combat') {
    state.phase = 'live'; state.timer = 83;
    player.state.position.set(0, 0, 9);
    settle(20);
    // One unobstructed foe at ~7 m so silhouette + team marking read at
    // 1280x720; a second at mid-left for depth. Both clear of the mid
    // containers from this angle.
    placeBot(foes[0], -2.5, 2); placeBot(foes[1], -7, 1);
    aimAt(-2.5, 1.3, 2);
    // Earn the kill for real: aim at the foe and fire until it drops.
    for (let i = 0; i < 40 && foes[0].alive; i++) {
      aimAt(foes[0].group.position.x, 1.3, foes[0].group.position.z);
      fireOnce();
      settle(6);
    }
    refreshHud();
    hud.setTimer(83, 'live');
    hud.setObjective('PLANT THE CHARGE — A CRANE BAY OR B TANK FARM');
  } else if (name === 'plant') {
    state.phase = 'live'; state.timer = 65;
    const site = map.sites.A.pos;
    // Inside the site ring, looking NORTH between the crane's legs toward the
    // North Depot: the rotating foe is framed by the legs, the ring's north arc
    // shows at the frame's edge. (Looking south put a leg 2 m off the lens.)
    player.state.position.set(site.x, 0, site.z + 2);
    settle(20);
    // Hold E in the site and let the real objective advance to ~62%.
    // The foe is placed only after the plant is under way, so it cannot
    // shoot the planter mid-capture.
    shotPlantHold = true;
    settle(112); // 1.87 s of the 3 s plant
    shotPlantHold = false;
    placeBot(foes[0], -14, -16);
    aimAt(-14, 1.3, -16);
    refreshHud();
    hud.setTimer(65, 'live');
    hud.setObjective('PLANT THE CHARGE — A CRANE BAY OR B TANK FARM');
  } else if (name === 'buy') {
    state.phase = 'buy'; state.timer = 15; state.money = 2450;
    state.owned = { shotgun: false, grenades: 0, armor: false };
    player.state.position.set(0, 0, 14);
    settle(20);
    aimAt(0, 1.5, -10);
    hud.showBuy(true, state);
    refreshHud();
    hud.setTimer(15, 'buy');
    hud.setObjective('BUY PHASE — GEAR UP');
  } else if (name === 'result') {
    // Win a real round: go live, drop all four foes through the real
    // damage path, and let the round system end it.
    round.skipBuy();
    for (const f of foes) bots.damage(f.torso, 200, 'torso', player.state.position);
    settle(90); // round ends (ALL WARDENS DOWN) inside the first steps
    const site = map.sites.A.pos;
    player.state.position.set(site.x + 4, 0, site.z + 5);
    settle(20);
    aimAt(site.x, 1.2, site.z);
    refreshHud();
  }
  // resetAll() opens the buy menu while the phase is still 'buy'; close it again for every
  // shot except the buy shot itself.
  hud.showBuy(name === 'buy', state);
  paintTwiceThenReady();
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
frameSyncCamera();
refreshHud();
// Verification handle (read-only state for the test harness): the game
// itself never reads it.
window.__ember = { state, bots, objective, round, arsenal, player, input, map, nav: bots.nav, nades: nadePool, resetAll, advanceRound };
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  hud.showBuy(false, state);
  requestAnimationFrame(frame);
}
