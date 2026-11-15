// bots.js — EMBERLINE bot AI (module C).
// 2 VANGUARD allies (teal trim) + 4 WARDEN foes (rust-red trim).
// Own code, own structure; no imports from player.js / weapons.js —
// all cross-module effects go through ctx callbacks only.
// Movement is a small local axis-separated AABB slide vs map.colliders.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createNav } from './nav.js';

const WALK = 3.2;
const PERCEIVE_DIST = 28;
const FOV_COS = 0.643; // cos(50 deg) — ~100 deg field of view
const DEFUSE_BAN = 2; // seconds a shot defuser is barred from re-entering 'defuse'
const RADIUS = 0.32;
const HEIGHT = 1.7;
const EYE = 1.5;
const FALL_TIME = 0.4;

// Module-level temps: zero allocation in the hot loop.
const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const _bodyGeo = new THREE.BoxGeometry(0.55, 0.75, 0.32);
const _trimGeo = new THREE.BoxGeometry(0.58, 0.14, 0.35); // wide chest band: team colour must read at 1280x720
const _headGeo = new THREE.SphereGeometry(0.16, 14, 10);
const _visorGeo = new THREE.BoxGeometry(0.2, 0.06, 0.05);
const _legGeo = new THREE.BoxGeometry(0.17, 0.52, 0.2);
const _gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);

function makeMats(team) {
  const trim = team === 'foe' ? PALETTE.foe : PALETTE.ally;
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x747b7d, roughness: 0.75, metalness: 0.1 }),
    trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(trim), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(trim), emissiveIntensity: 0.13 }),
    head: new THREE.MeshStandardMaterial({ color: 0x9b9182, roughness: 0.7, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x41494e, roughness: 0.85 }),
  };
}

function buildBotMesh(scene, bot, mats) {
  const g = new THREE.Group();
  const legL = new THREE.Mesh(_legGeo, mats.dark);
  legL.position.set(-0.13, 0.26, 0);
  const legR = new THREE.Mesh(_legGeo, mats.dark);
  legR.position.set(0.13, 0.26, 0);
  const torso = new THREE.Mesh(_bodyGeo, mats.body);
  torso.position.y = 1.02;
  const trim = new THREE.Mesh(_trimGeo, mats.trim);
  trim.position.y = 1.28;
  const head = new THREE.Mesh(_headGeo, mats.head);
  head.position.y = 1.58;
  const visor = new THREE.Mesh(_visorGeo, mats.trim);
  visor.position.set(0, 1.6, 0.14);
  const gun = new THREE.Mesh(_gunGeo, mats.dark);
  gun.position.set(0.14, 1.12, 0.32);
  g.add(legL, legR, torso, trim, head, visor, gun);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  torso.userData = { bot, part: 'torso' };
  head.userData = { bot, part: 'head' };
  legL.userData = { bot, part: 'legs' };
  legR.userData = { bot, part: 'legs' };
  scene.add(g);
  return { group: g, torso, head, legL, legR };
}

export function createBots(scene, map, ctx) {
  const rnd = (ctx && ctx.random) || Math.random;
  const nav = createNav(map); // shared waypoint graph (A* + stuck recovery)
  const allyMats = makeMats('you');
  const foeMats = makeMats('foe');
  const list = [];
  const hitMeshes = [];
  let now = 0;

  function spawnBot(team, role, home, routeKey) {
    const mats = team === 'foe' ? foeMats : allyMats;
    const bot = {
      team, group: null, torso: null, head: null,
      health: 100, alive: true,
      state: team === 'foe' ? (role === 'mid' ? 'hold' : 'patrol') : 'patrol',
      route: routeKey || null, wp: 0, routeIdx: 0,
      lastKnown: null, reactAt: 0, fireAt: 0, burstLeft: 0, role,
      home: home.clone(), yaw: team === 'foe' ? 0 : Math.PI,
      target: null, targetIsPlayer: false, loseAt: 0, scanT: 0, holdT: 0,
      fall: 0, noDefuseUntil: 0, holdPos: null, followDx: 0, followDz: 0,
      alertAt: -10, // last time this bot was damaged (damage snaps it alert)
      path: null, pathIdx: 0, pathTx: 0, pathTz: 0, stuckT: 0, lastPx: 0, lastPz: 0,
    };
    const built = buildBotMesh(scene, bot, mats);
    bot.group = built.group;
    bot.torso = built.torso;
    bot.head = built.head;
    bot.group.position.copy(home);
    bot.group.rotation.y = bot.yaw;
    hitMeshes.push(built.torso, built.head, built.legL, built.legR);
    list.push(bot);
    return bot;
  }

  // --- roster: allies follow the player, foes defend the sites ---
  const a0 = spawnBot('you', 'follow', map.spawns.allies[0]);
  a0.followDx = -1.6; a0.followDz = 1.6;
  const a1 = spawnBot('you', 'follow', map.spawns.allies[1]);
  a1.followDx = 1.6; a1.followDz = 1.6;
  const f0 = spawnBot('foe', 'runner', map.spawns.foes[0], 'A');
  const f1 = spawnBot('foe', 'runner', map.spawns.foes[1], 'B');
  const f2 = spawnBot('foe', 'mid', map.spawns.foes[2]);
  f2.holdPos = new THREE.Vector3(0, 0, -4);
  const f3 = spawnBot('foe', 'roamer', map.spawns.foes[3]);
  f3.holdPos = map.cover.length ? map.cover[0].clone() : new THREE.Vector3(6, 0, -8);

  // --- local collision: axis-separated AABB slide vs map.colliders ---
  // The floor's Box3 max.y is 2.98e-9 (float32), not 0 — a strict `0 <`
  // test lets the floor block the whole map and no bot ever moves. The
  // 0.05 threshold mirrors the player's LIFT (player.js): only colliders
  // rising meaningfully above the floor block a bot.
  function blocked(x, z) {
    if (x < map.bounds.minX + RADIUS || x > map.bounds.maxX - RADIUS ||
        z < map.bounds.minZ + RADIUS || z > map.bounds.maxZ - RADIUS) return true;
    for (let i = 0; i < map.colliders.length; i += 1) {
      const c = map.colliders[i];
      if (x + RADIUS > c.min.x && x - RADIUS < c.max.x &&
          z + RADIUS > c.min.z && z - RADIUS < c.max.z &&
          HEIGHT > c.min.y && 0.05 < c.max.y) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, speed, dt) {
    const p = bot.group.position;
    _dir.set(tx - p.x, 0, tz - p.z);
    const d = Math.hypot(_dir.x, _dir.z);
    if (d < 0.05) return true;
    _dir.x /= d; _dir.z /= d;
    const step = speed * dt;
    const nx = p.x + _dir.x * step;
    if (!blocked(nx, p.z)) p.x = nx;
    const nz = p.z + _dir.z * step;
    if (!blocked(p.x, nz)) p.z = nz;
    faceToward(bot, _dir.x, _dir.z, dt, 8);
    return d < 0.6;
  }

  // Routed movement: A* over the shared waypoint graph, with stuck
  // recovery. Replanning the same blocked waypoint forever is useless, so
  // a bot that makes no progress for 0.75 s skips the waypoint it cannot
  // reach and carries on down the path.
  function navMove(bot, tx, tz, speed, dt) {
    const p = bot.group.position;
    if (!bot.path || Math.hypot(tx - bot.pathTx, tz - bot.pathTz) > 0.5) {
      bot.path = nav.findPath(p.x, p.z, tx, tz) || [];
      bot.pathIdx = 0; bot.pathTx = tx; bot.pathTz = tz;
      bot.stuckT = 0; bot.lastPx = p.x; bot.lastPz = p.z;
    }
    let done = false;
    if (bot.pathIdx < bot.path.length) {
      const wp = bot.path[bot.pathIdx];
      if (moveToward(bot, wp.x, wp.z, speed, dt)) bot.pathIdx += 1;
    } else {
      done = moveToward(bot, tx, tz, speed, dt);
      if (done) bot.path = null;
    }
    bot.stuckT += dt;
    if (bot.stuckT >= 0.75) {
      const moved = Math.hypot(p.x - bot.lastPx, p.z - bot.lastPz);
      if (moved < 0.15 && bot.path && bot.pathIdx < bot.path.length) bot.pathIdx += 1;
      bot.stuckT = 0; bot.lastPx = p.x; bot.lastPz = p.z;
    }
    return done;
  }

  function faceToward(bot, dx, dz, dt, rate) {
    const want = Math.atan2(dx, dz);
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, rate * dt);
    bot.group.rotation.y = bot.yaw;
  }

  function eyeOf(bot) {
    return _eye.set(bot.group.position.x, EYE, bot.group.position.z);
  }

  // --- perception: range + FOV + line of sight ---
  function canSee(bot, tx, ty, tz) {
    const p = bot.group.position;
    _dir.set(tx - p.x, ty - EYE, tz - p.z);
    const dist = _dir.length();
    if (dist > PERCEIVE_DIST) return -1;
    _dir.multiplyScalar(1 / dist);
    _fwd.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    if (_dir.x * _fwd.x + _dir.z * _fwd.z < FOV_COS) return -1;
    _tgt.set(tx, ty, tz);
    if (!ctx.los(eyeOf(bot), _tgt)) return -1;
    return dist;
  }

  function acquire(bot, world) {
    // Returns { bot|null, isPlayer, dist } — nearest visible enemy.
    let best = null; let bestIsPlayer = false; let bestDist = Infinity;
    if (bot.team === 'foe') {
      if (world.playerAlive) {
        const d = canSee(bot, world.playerPos.x, world.playerPos.y + 1.3, world.playerPos.z);
        if (d >= 0) { bestDist = d; bestIsPlayer = true; }
      }
      for (let i = 0; i < list.length; i += 1) {
        const o = list[i];
        if (o.team !== 'you' || !o.alive) continue;
        const d = canSee(bot, o.group.position.x, 1.25, o.group.position.z);
        if (d >= 0 && d < bestDist) { best = o; bestDist = d; bestIsPlayer = false; }
      }
    } else {
      for (let i = 0; i < list.length; i += 1) {
        const o = list[i];
        if (o.team !== 'foe' || !o.alive) continue;
        const d = canSee(bot, o.group.position.x, 1.25, o.group.position.z);
        if (d >= 0 && d < bestDist) { best = o; bestDist = d; bestIsPlayer = false; }
      }
    }
    if (bestIsPlayer) return { bot: null, isPlayer: true, dist: bestDist };
    return best ? { bot: best, isPlayer: false, dist: bestDist } : null;
  }

  function killBot(victim, killerTeam) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.fall = 0;
    victim.target = null;
    victim.burstLeft = 0;
    victim.state = 'hold';
    if (ctx.onKill) ctx.onKill(victim, killerTeam);
  }

  function shootAt(bot, seen) {
    // One burst shot: tracer via onShootBot, hit roll, falloff damage 9–15.
    const p = bot.group.position;
    let tx; let ty; let tz;
    if (seen.isPlayer) {
      // aim at the player's last known position (no stale exact tracking)
      tx = bot.lastKnown.x; ty = 1.3; tz = bot.lastKnown.z;
    } else {
      tx = seen.bot.group.position.x; ty = 1.25; tz = seen.bot.group.position.z;
    }
    // fresh vector: the callback may retain targetPos (tracer endpoint)
    if (ctx.onShootBot) ctx.onShootBot(bot, new THREE.Vector3(tx, ty, tz));
    const dist = seen.dist;
    // Allies are support, not the win condition: they shoot less accurately
    // and hit softer than foes, so the player stays the primary damage
    // dealer and rounds last long enough for the bomb objective to matter.
    const allyScale = bot.team === 'you' ? 0.7 : 1;
    const hitP = Math.max(0.18, Math.min(0.6, 0.62 - dist * 0.013)) * allyScale;
    if (rnd() > hitP) return;
    const dmg = Math.max(9, Math.min(15, Math.round((15 - (dist / PERCEIVE_DIST) * 6 + rnd() * 2 - 1) * (bot.team === 'you' ? 0.6 : 1))));
    if (seen.isPlayer) {
      if (ctx.onDamagePlayer) ctx.onDamagePlayer(dmg, p);
    } else if (seen.bot.alive) {
      seen.bot.health -= dmg;
      // Shooting a defuser interrupts the defuse: it drops to 'rotate' AND
      // is barred from re-entering 'defuse' for DEFUSE_BAN seconds. Without
      // the ban the next tick re-enters 'defuse' (the bot is still within
      // 2 m of the bomb) and the interruption lasts zero ticks.
      if (seen.bot.state === 'defuse') { seen.bot.state = 'rotate'; seen.bot.noDefuseUntil = now + DEFUSE_BAN; }
      // Shot from somewhere: snap the victim alert toward its attacker.
      seen.bot.alertAt = now;
      seen.bot.reactAt = now;
      if (!seen.bot.lastKnown) seen.bot.lastKnown = new THREE.Vector3();
      seen.bot.lastKnown.set(p.x, 0, p.z);
      if (seen.bot.health <= 0) killBot(seen.bot, bot.team);
    }
  }

  function combat(bot, seen, dt) {
    const p = bot.group.position;
    const tx = seen.isPlayer ? bot.lastKnown.x : seen.bot.group.position.x;
    const tz = seen.isPlayer ? bot.lastKnown.z : seen.bot.group.position.z;
    faceToward(bot, tx - p.x, tz - p.z, dt, 10);
    if (now < bot.reactAt) return;
    if (bot.burstLeft <= 0) {
      // The pause set at the end of the last burst must actually elapse:
      // starting a burst early overwrites it and the bot fires continuously.
      if (now < bot.fireAt) return;
      bot.burstLeft = 3 + Math.floor(rnd() * 3); // 3–5 shots
      bot.fireAt = now;
    }
    if (now >= bot.fireAt && bot.burstLeft > 0) {
      bot.fireAt = now + 0.12;
      bot.burstLeft -= 1;
      shootAt(bot, seen);
      if (bot.burstLeft <= 0) bot.fireAt = now + 0.5 + rnd() * 0.6; // pause between bursts
    }
  }

  function routeWaypoints(bot) {
    const routes = map.routes[bot.route];
    if (!routes || !routes.length) return null;
    return routes[bot.routeIdx % routes.length];
  }

  function patrolStep(bot, dt, world) {
    if (bot.role === 'runner') {
      const wps = routeWaypoints(bot);
      if (!wps || !wps.length) { bot.state = 'hold'; return; }
      const wp = wps[bot.wp % wps.length];
      if (navMove(bot, wp.x, wp.z, WALK, dt)) {
        bot.wp += 1;
        if (bot.wp >= wps.length) { bot.state = 'hold'; bot.holdT = 0; }
      }
      return;
    }
    if (bot.role === 'roamer') {
      const c = map.cover;
      if (!c.length) return;
      const dest = c[bot.wp % c.length];
      if (navMove(bot, dest.x, dest.z, WALK, dt)) {
        bot.wp += 1;
        bot.state = 'hold'; bot.holdT = 0;
      }
      return;
    }
    // allies: follow the player at an offset; after plant, ally 0 holds the bomb site
    if (bot.team === 'you') {
      if (world.bombStatus === 'planted' && world.bombPos && bot === a0) {
        if (moveToward(bot, world.bombPos.x + 2.5, world.bombPos.z + 2.5, WALK, dt)) bot.state = 'hold';
        return;
      }
      if (!world.playerAlive) { bot.state = 'hold'; return; }
      const tx = world.playerPos.x + bot.followDx;
      const tz = world.playerPos.z + bot.followDz;
      const d = Math.hypot(tx - bot.group.position.x, tz - bot.group.position.z);
      if (d > 1.4) moveToward(bot, tx, tz, WALK, dt);
      else faceToward(bot, world.playerPos.x - bot.group.position.x, world.playerPos.z - bot.group.position.z, dt, 4);
      return;
    }
    bot.state = 'hold';
  }

  function holdStep(bot, dt) {
    // the mid holder walks to its hold position first, then scans from there
    // (holdPos was set at spawn but never used — the holder sat at spawn)
    if (bot.role === 'mid' && bot.holdPos) {
      const p = bot.group.position;
      if (Math.hypot(bot.holdPos.x - p.x, bot.holdPos.z - p.z) > 0.6) {
        moveToward(bot, bot.holdPos.x, bot.holdPos.z, WALK, dt);
        return;
      }
    }
    // slow scan: sweep yaw back and forth
    bot.scanT += dt;
    bot.yaw += Math.sin(bot.scanT * 0.7) * 0.35 * dt;
    bot.group.rotation.y = bot.yaw;
    bot.holdT += dt;
    if (bot.role === 'runner' || bot.role === 'roamer') {
      if (bot.holdT > 4) { bot.state = 'patrol'; bot.holdT = 0; }
    }
  }

  function stepBot(bot, dt, world) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / FALL_TIME);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    const seen = acquire(bot, world);
    if (seen) {
      if (!bot.lastKnown) bot.lastKnown = new THREE.Vector3();
      if (seen.isPlayer) bot.lastKnown.set(world.playerPos.x, 0, world.playerPos.z);
      else bot.lastKnown.set(seen.bot.group.position.x, 0, seen.bot.group.position.z);
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        // Damaged in the last 2 s? No reaction delay — damage snaps the bot
        // alert (see damage()/shootAt()); otherwise the delay applies.
        bot.reactAt = (now - bot.alertAt < 2) ? now : now + 0.35 + rnd() * 0.35;
        bot.burstLeft = 0;
      }
      bot.loseAt = now + 2.5;
      combat(bot, seen, dt);
      return;
    }
    if (bot.state === 'engage') {
      if (now < bot.loseAt && bot.lastKnown) {
        bot.state = 'investigate';
      } else {
        bot.state = bot.team === 'foe' ? (bot.role === 'mid' ? 'hold' : 'patrol') : 'patrol';
        bot.target = null;
      }
      bot.burstLeft = 0;
    }
    // post-plant: foes rotate to the bomb site; nearest one defuses inside 2 m.
    // The check MUST include 'defusing': while a foe is defusing the status
    // is 'defusing', and a 'planted'-only test lets every foe fall through
    // to patrol/investigate mid-defuse, walk away, and reset the defuse —
    // the bomb then flaps planted/defusing forever and never gets defused.
    if (bot.team === 'foe' && (world.bombStatus === 'planted' || world.bombStatus === 'defusing') && world.bombPos) {
      const p = bot.group.position;
      const d = Math.hypot(world.bombPos.x - p.x, world.bombPos.z - p.z);
      if ((bot.state === 'defuse' || d < 2) && now >= bot.noDefuseUntil) {
        bot.state = 'defuse';
        faceToward(bot, world.bombPos.x - p.x, world.bombPos.z - p.z, dt, 6);
        return;
      }
      bot.state = 'rotate';
      navMove(bot, world.bombPos.x, world.bombPos.z, WALK, dt);
      return;
    }
    if (bot.state === 'investigate' && bot.lastKnown) {
      if (navMove(bot, bot.lastKnown.x, bot.lastKnown.z, WALK, dt)) {
        bot.state = bot.team === 'foe' ? (bot.role === 'mid' ? 'hold' : 'patrol') : 'patrol';
        bot.lastKnown = null;
      }
      return;
    }
    if (bot.state === 'hold') { holdStep(bot, dt); return; }
    patrolStep(bot, dt, world);
  }

  return {
    list,
    hitMeshes,
    nav,
    step(dt, world) {
      now += dt;
      if (world.phase !== 'live') {
        // frozen between rounds — only finish fall-over animation
        for (let i = 0; i < list.length; i += 1) {
          const b = list[i];
          if (!b.alive && b.fall < 1) {
            b.fall = Math.min(1, b.fall + dt / FALL_TIME);
            b.group.rotation.x = -b.fall * 1.45;
            b.group.position.y = -b.fall * 0.08;
          }
        }
        return;
      }
      for (let i = 0; i < list.length; i += 1) stepBot(list[i], dt, world);
    },
    damage(mesh, amount, part, atk) {
      if (!mesh || !mesh.userData) return null;
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return null;
      bot.health -= amount;
      // Shooting a defuser interrupts the defuse (see shootAt): 'rotate' +
      // a 2 s ban from re-entering 'defuse', or the next tick undoes it.
      if (bot.state === 'defuse') { bot.state = 'rotate'; bot.noDefuseUntil = now + DEFUSE_BAN; }
      // Being shot snaps the bot to full alert: no reaction delay on next
      // sighting, and it turns toward its attacker.
      bot.alertAt = now;
      bot.reactAt = Math.min(bot.reactAt, now);
      if (atk) {
        if (!bot.lastKnown) bot.lastKnown = new THREE.Vector3();
        bot.lastKnown.set(atk.x, 0, atk.z);
      }
      if (bot.health <= 0) {
        // 'player' = killed by the player's own gun/grenade: only this killer
        // team credits the player's kill count + $150 (see main.js onKill).
        killBot(bot, 'player');
        return { killed: true, bot };
      }
      return { killed: false, bot };
    },
    reset() {
      for (let i = 0; i < list.length; i += 1) {
        const b = list[i];
        b.health = 100;
        b.alive = true;
        b.fall = 0;
        b.group.position.copy(b.home);
        b.group.rotation.set(0, b.yaw, 0);
        b.group.position.y = 0;
        b.yaw = b.team === 'foe' ? 0 : Math.PI;
        b.group.rotation.y = b.yaw;
        b.state = b.team === 'foe' ? (b.role === 'mid' ? 'hold' : 'patrol') : 'patrol';
        b.wp = 0;
        b.lastKnown = null;
        b.reactAt = 0;
        b.fireAt = 0;
        b.burstLeft = 0;
        b.target = null;
        b.noDefuseUntil = 0;
        b.holdT = 0;
        b.alertAt = -10;
        b.path = null; b.pathIdx = 0; b.stuckT = 0;
      }
    },
    alive(team) {
      let n = 0;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].team === team && list[i].alive) n += 1;
      }
      return n;
    },
    // Gunfire is audible: a shot pulls patrolling / holding foes toward the
    // shooter's position to investigate (they walk to lastKnown, then resume).
    // Engaging / defusing bots are not interrupted.
    hearShot(x, z) {
      for (let i = 0; i < list.length; i += 1) {
        const b = list[i];
        if (b.team !== 'foe' || !b.alive) continue;
        if (b.state !== 'patrol' && b.state !== 'hold') continue;
        const dx = x - b.group.position.x;
        const dz = z - b.group.position.z;
        if (dx * dx + dz * dz > 22 * 22) continue;
        if (!b.lastKnown) b.lastKnown = new THREE.Vector3();
        b.lastKnown.set(x, 0, z);
        b.state = 'investigate';
      }
    },
    aimPoint(i) {
      const b = list[i % list.length];
      return new THREE.Vector3(b.group.position.x, 1.25, b.group.position.z);
    },
  };
}
