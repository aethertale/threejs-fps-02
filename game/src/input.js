// Keyboard + mouse input behind pointer lock: held keys, look deltas,
// edge-triggered presses. No allocation in the hot path (takeLook reuses one object).
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const edges = new Set();
  const look = { x: 0, y: 0 };
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function clearAll() {
    keys.clear();
    edges.clear();
    state.firing = false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    edges.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', clearAll);
  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  });
  window.addEventListener('mousedown', (e) => {
    if (state.locked && e.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) clearAll();
    if (onLockChange) onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      look.x = state.lookX;
      look.y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    // True once per physical press; consumed on read.
    pressed(code) {
      if (!edges.has(code)) return false;
      edges.delete(code);
      return true;
    },
  };
}
