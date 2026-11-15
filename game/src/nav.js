// nav.js — EMBERLINE shared waypoint graph (module C).
// A small A* graph every bot movement mode routes through: the 3 lanes,
// site approaches, cover positions, spawns. Edges are validated at load
// against the map's colliders (sampled, bot radius 0.45), so a route can
// never ask a bot to walk through a wall. Unreachable nodes warn once.
import * as THREE from 'three';

const RADIUS = 0.45;

// [x, z] — lane junctions, site approaches, cover, spawns. All checked
// against colliders at construction; a node inside geometry is dropped.
const NODES = [
  [0, -15], [0, -9], [0, -2], [0, 9], [0, 14],
  [-7, -15], [-12, -14], [-14, -12], [-12, -12], [-14, -9],
  [-12, -10], [-7, 0], [-14, 2], [-18, 3], [-9, 4], [-16, -14],
  [7, -15], [14, -12], [12, -12], [14, -9],
  [12, -10], [7, 0], [14, 2], [18, 3], [9, 4],
  [-3, -13], [3, -13], [-6, -14], [6, -14],
  // Bridges (fix 2026-11-15): the mid-lane barrier (0,-7), the pillar (0,0)
  // and the platform (0,6) cut the spine, and the crate (9,-12) + tank
  // (11,-14.5) wall isolates site B — without these, 15 of 29 nodes were
  // unreachable from spawn. (-5,-9)/(5,-9) route around the barrier,
  // (-4,8)/(4,8) around the platform, (-9,-10)/(9,-10) around the
  // crate/tank wall. Verified 35/35 reachable (meta/navcheck.mjs).
  [-5, -9], [5, -9], [-4, 8], [4, 8], [-9, -10], [9, -10],
];

const LINK_DIST = 9.5;

export function createNav(map) {
  const colliders = map.colliders;
  const bounds = map.bounds;

  function blocked(x, z) {
    if (x < bounds.minX + RADIUS || x > bounds.maxX - RADIUS ||
        z < bounds.minZ + RADIUS || z > bounds.maxZ - RADIUS) return true;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (x + RADIUS > c.min.x && x - RADIUS < c.max.x &&
          z + RADIUS > c.min.z && z - RADIUS < c.max.z &&
          1.7 > c.min.y && 0.05 < c.max.y) return true;
    }
    return false;
  }

  function edgeClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.4));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      if (blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  const nodes = [];
  for (let i = 0; i < NODES.length; i += 1) {
    if (!blocked(NODES[i][0], NODES[i][1])) nodes.push({ x: NODES[i][0], z: NODES[i][1] });
  }
  const adj = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const list = [];
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const dx = nodes[j].x - nodes[i].x;
      const dz = nodes[j].z - nodes[i].z;
      if (dx * dx + dz * dz > LINK_DIST * LINK_DIST) continue;
      if (edgeClear(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z)) list.push(j);
    }
    adj.push(list);
  }
  // Connectivity check: every node must be reachable from node 0 (spawn).
  if (nodes.length) {
    const seen = new Set([0]);
    const q = [0];
    while (q.length) {
      const cur = q.pop();
      for (const nb of adj[cur]) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    if (seen.size < nodes.length) {
      console.warn('[nav] unreachable nodes:', nodes.length - seen.size, 'of', nodes.length);
    }
  }

  function nearest(x, z) {
    let best = 0; let bd = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i].x - x;
      const dz = nodes[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function findPath(x0, z0, x1, z1) {
    if (!nodes.length) return null;
    const start = nearest(x0, z0);
    const goal = nearest(x1, z1);
    if (start === goal) return [];
    // A* over ≤32 nodes: linear open-list scan is fast enough.
    const g = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const closed = new Uint8Array(nodes.length);
    const open = [start];
    g[start] = 0;
    const h = (i) => Math.hypot(nodes[i].x - x1, nodes[i].z - z1);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (g[open[i]] + h(open[i]) < g[open[bi]] + h(open[bi])) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const nb of adj[cur]) {
        const ng = g[cur] + Math.hypot(nodes[nb].x - nodes[cur].x, nodes[nb].z - nodes[cur].z);
        if (ng < g[nb]) {
          g[nb] = ng;
          prev[nb] = cur;
          if (!closed[nb] && !open.includes(nb)) open.push(nb);
        }
      }
    }
    if (!isFinite(g[goal])) return null;
    const path = [];
    let cur = goal;
    while (cur !== -1 && cur !== start) { path.push(nodes[cur]); cur = prev[cur]; }
    path.reverse();
    return path;
  }

  return { nodes, findPath, nearest };
}
