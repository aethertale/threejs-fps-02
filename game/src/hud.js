// DOM HUD only: never touches the simulation. main.js pushes numbers in,
// reads play / buy / next-round callbacks out. Writes are cached so per-frame
// refresh calls from main.js do not churn the DOM.
const $ = (id) => document.getElementById(id);

const BUY = [
  { id: 'shotgun', name: 'BREACH-12', price: 600 },
  { id: 'grenade', name: 'SPARK-9', price: 300 },
  { id: 'armor', name: 'PLATE VEST', price: 400 },
  { id: 'ammo', name: 'AMMO REFILL', price: 200 },
  { id: 'smg', name: 'VIPER-9', price: 900 },
];

export function createHud() {
  const el = {};
  for (const id of ['hud', 'crosshair', 'hitmarker', 'health', 'health-num', 'armor',
    'ammo', 'ammo-mag', 'ammo-reserve', 'weapon-name', 'money', 'timer', 'score',
    'score-you', 'score-foe', 'round-num', 'kills', 'objective', 'caption', 'feed',
    'minimap', 'plant-bar', 'plant-fill', 'buy-menu', 'buy-close', 'overlay', 'overlay-title',
    'overlay-copy', 'scoreboard', 'play', 'next-round', 'keys', 'damage-vignette', 'down-banner']) {
    el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id);
  }
  const items = BUY.map((b) => ({
    ...b,
    root: $('buy-' + b.id),
    stateEl: $('buy-' + b.id).querySelector('.buy-state'),
  }));

  let lastHealth = -1, lastArmor = null, lastMag = -1, lastReserve = -1, lastWeapon = '';
  let lastMoney = -1, lastTimer = '', lastScore = '', lastObjective = '', lastCaption = '\n';
  let lastKills = -1, lastBuySig = '', baseTimerText = '', bombTimerOn = false;
  let hitTimer = 0, dmgTimer = 0;
  let playFn = null, buyFn = null, nextFn = null;

  // Minimap: one visible canvas + one pre-rendered static layer (walls +
  // site markers). updateMinimap redraws only the dynamic dots + arrow.
  const MM_W = 168, MM_H = 140;
  let mmMap = null, mmCtx = null, mmOff = null, mmOffCtx = null;
  function mmProject(x, z) {
    const b = mmMap.bounds;
    return [
      ((x - b.minX) / (b.maxX - b.minX)) * MM_W,
      ((z - b.minZ) / (b.maxZ - b.minZ)) * MM_H,
    ];
  }

  function moneyFmt(n) {
    return '$' + Number(n || 0).toLocaleString('en-US');
  }

  const hud = {
    setHealth(hp, armor) {
      hp = Math.max(0, Math.min(100, Math.round(hp)));
      const hasArmor = !!armor;
      if (hp === lastHealth && hasArmor === lastArmor) return;
      lastHealth = hp;
      lastArmor = hasArmor;
      el.healthNum.textContent = String(hp);
      el.health.style.setProperty('--hp', hp + '%');
      el.health.classList.toggle('low', hp <= 30);
      el.armor.textContent = hasArmor ? 'ARMOR' : 'NO ARMOR';
      el.armor.classList.toggle('on', hasArmor);
    },
    setAmmo(mag, reserve, weaponName) {
      if (mag === lastMag && reserve === lastReserve && weaponName === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weaponName || '';
      el.ammoMag.textContent = String(mag);
      el.ammoReserve.textContent = '/ ' + reserve;
      if (weaponName) el.weaponName.textContent = weaponName;
      el.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(n) {
      if (n === lastMoney) return;
      lastMoney = n;
      el.money.textContent = moneyFmt(n);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      baseTimerText = text;
      if (bombTimerOn) return;
      if (text === lastTimer) return;
      lastTimer = text;
      el.timer.textContent = text;
      el.timer.classList.toggle('buy', phase === 'buy');
    },
    setBombTimer(seconds) {
      if (seconds == null) {
        if (!bombTimerOn) return;
        bombTimerOn = false;
        el.timer.textContent = baseTimerText;
        el.timer.classList.remove('bomb');
        lastTimer = baseTimerText;
        return;
      }
      const s = Math.max(0, Math.ceil(seconds));
      const text = 'BOMB ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      bombTimerOn = true;
      if (text === lastTimer) return;
      lastTimer = text;
      el.timer.textContent = text;
      el.timer.classList.add('bomb');
    },
    setScore(you, foe, round) {
      const sig = you + '-' + foe + '-' + round;
      if (sig === lastScore) return;
      lastScore = sig;
      el.scoreYou.textContent = String(you);
      el.scoreFoe.textContent = String(foe);
      el.roundNum.textContent = 'ROUND ' + round;
    },
    setKills(n) {
      if (n === lastKills) return;
      lastKills = n;
      el.kills.textContent = 'KILLS ' + n;
    },
    setObjective(text) {
      if (text === lastObjective) return;
      lastObjective = text;
      el.objective.textContent = text;
    },
    setCaption(text) {
      if (text === lastCaption) return;
      lastCaption = text;
      el.caption.textContent = text || '';
      el.caption.hidden = !text;
    },
    hitMarker(killed, holdMs) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.remove('on', 'kill');
      }, holdMs || 90);
    },
    damageFlash() {
      el.damageVignette.classList.add('on');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => el.damageVignette.classList.remove('on'), 180);
    },
    showBuy(visible, state) {
      const sig = visible + '|' + (state ? state.money + '|' + state.owned.shotgun + '|' +
        state.owned.grenades + '|' + state.owned.armor + '|' + state.owned.smg : '');
      el.buyMenu.hidden = !visible;
      if (!visible || sig === lastBuySig) return;
      lastBuySig = sig;
      for (const it of items) {
        let owned = false, label = '';
        if (it.id === 'shotgun') owned = !!state.owned.shotgun;
        if (it.id === 'armor') owned = !!state.owned.armor;
        if (it.id === 'smg') owned = !!state.owned.smg;
        if (it.id === 'grenade') {
          owned = state.owned.grenades > 0;
          label = owned ? 'OWNED x' + state.owned.grenades : '';
        }
        if (owned && !label) label = 'OWNED';
        it.stateEl.textContent = label;
        it.root.classList.toggle('owned', owned);
        it.root.classList.toggle('cant', !owned && state.money < it.price);
      }
    },
    showOverlay(mode, data) {
      if (mode === 'down') {
        el.overlay.hidden = true;
        el.downBanner.hidden = false;
        return;
      }
      el.downBanner.hidden = true;
      el.overlay.hidden = false;
      el.nextRound.hidden = true;
      el.play.hidden = false;
      el.scoreboard.hidden = true;
      el.keys.hidden = mode !== 'start';
      if (mode === 'start') {
        el.overlayTitle.textContent = 'EMBERLINE';
        el.overlayCopy.textContent = 'Tactical round shooter in the Kestrel Yard. Attack with VANGUARD — plant the charge at CRANE BAY or TANK FARM. First to 5 rounds takes the match.';
        el.play.textContent = 'DEPLOY';
      } else if (mode === 'paused') {
        el.overlayTitle.textContent = 'PAUSED';
        el.overlayCopy.textContent = 'Pointer lock released. Click to resume the round.';
        el.play.textContent = 'RESUME';
      } else if (mode === 'round') {
        const d = data || {};
        const win = !!d.win;
        el.overlayTitle.textContent = win ? 'ROUND WON' : 'ROUND LOST';
        el.overlayCopy.textContent = (d.reason || '') + ' — ' + (win ? 'ROUND WON' : 'ROUND LOST') +
          '  +$' + (d.award || 0).toLocaleString('en-US');
        el.play.hidden = true;
        el.nextRound.hidden = false;
      } else if (mode === 'match') {
        const d = data || {};
        const win = d.winner === 'you' || !!d.win;
        el.overlayTitle.textContent = win ? 'MATCH WON' : 'MATCH LOST';
        el.overlayCopy.textContent = win
          ? 'VANGUARD takes the yard. First to 5 rounds — match secured.'
          : 'WARDENS hold the yard. First to 5 rounds — match lost.';
        el.play.textContent = 'PLAY AGAIN';
        const s = d.stats || {};
        el.scoreboard.hidden = false;
        el.scoreboard.innerHTML =
          '<div class="sb-row"><span>ROUNDS</span><b>' + (s.you | 0) + ' — ' + (s.foe | 0) + '</b></div>' +
          '<div class="sb-row"><span>KILLS</span><b>' + (s.kills | 0) + '</b></div>' +
          '<div class="sb-row"><span>DEATHS</span><b>' + (s.deaths | 0) + '</b></div>' +
          '<div class="sb-row"><span>HEADSHOTS</span><b>' + (s.headshots | 0) + '</b></div>' +
          '<div class="sb-row"><span>MONEY</span><b>' + moneyFmt(s.money) + '</b></div>';
      }
    },
    hideOverlay() {
      el.overlay.hidden = true;
      el.downBanner.hidden = true;
    },
    onPlay(fn) { playFn = fn; },
    onBuy(fn) { buyFn = fn; },
    onNextRound(fn) { nextFn = fn; },
    setPlant(progress) {
      if (progress == null) {
        el.plantBar.hidden = true;
        return;
      }
      el.plantBar.hidden = false;
      el.plantFill.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
    },
    feed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      el.feed.prepend(line);
      while (el.feed.children.length > 6) el.feed.removeChild(el.feed.lastChild);
    },
    initMinimap(mapData) {
      if (!mapData || !mapData.bounds || !mapData.colliders || !el.minimap) return;
      // The WebGL canvas is appended to document.body AFTER #hud (render.js),
      // so a <canvas> left inside #hud would be document.querySelector('canvas')
      // first and its mostly-transparent bitmap would break the load check's
      // luminance read — reparent to the end of <body>. The CSS is
      // position:fixed, so the on-screen placement is unchanged.
      document.body.appendChild(el.minimap);
      mmMap = mapData;
      mmCtx = el.minimap.getContext('2d');
      mmOff = document.createElement('canvas');
      mmOff.width = MM_W; mmOff.height = MM_H;
      mmOffCtx = mmOff.getContext('2d');
      // Static layer: walls (floor skipped — its Box3 max.y is ~0) + site rings.
      for (const c of mmMap.colliders) {
        if (c.max.y <= 0.05) continue;
        const p0 = mmProject(c.min.x, c.min.z);
        const p1 = mmProject(c.max.x, c.max.z);
        mmOffCtx.fillStyle = '#5d5347';
        mmOffCtx.fillRect(p0[0], p0[1], Math.max(1, p1[0] - p0[0]), Math.max(1, p1[1] - p0[1]));
      }
      const siteCols = { A: '#ff9a2e', B: '#2e8f86' };
      for (const key of ['A', 'B']) {
        const s = mmMap.sites && mmMap.sites[key];
        if (!s) continue;
        const p = mmProject(s.pos.x, s.pos.z);
        mmOffCtx.strokeStyle = siteCols[key];
        mmOffCtx.lineWidth = 1;
        mmOffCtx.beginPath(); mmOffCtx.arc(p[0], p[1], 7, 0, Math.PI * 2); mmOffCtx.stroke();
        mmOffCtx.fillStyle = siteCols[key];
        mmOffCtx.font = 'bold 9px ui-monospace, Menlo, monospace';
        mmOffCtx.textAlign = 'center'; mmOffCtx.textBaseline = 'middle';
        mmOffCtx.fillText(key, p[0], p[1]);
      }
    },
    updateMinimap(playerState, botsList, nowFn) {
      if (!mmCtx || !mmOff || !mmMap || !playerState || !playerState.position) return;
      mmCtx.clearRect(0, 0, MM_W, MM_H);
      mmCtx.drawImage(mmOff, 0, 0);
      const now = typeof nowFn === 'function' ? nowFn() : null;
      if (botsList) {
        for (const b of botsList) {
          if (!b || !b.alive || !b.group) continue;
          const p = mmProject(b.group.position.x, b.group.position.z);
          if (b.team === 'you') {
            mmCtx.fillStyle = '#2e8f86';
            mmCtx.beginPath(); mmCtx.arc(p[0], p[1], 3, 0, Math.PI * 2); mmCtx.fill();
          } else if (b.team === 'foe') {
            // Foes only while recently seen (bots.now / bot.seenAt come
            // from the bots module; without them no foe dot is drawn).
            if (now == null || b.seenAt == null || now - b.seenAt >= 3) continue;
            mmCtx.fillStyle = '#c4452a';
            mmCtx.beginPath(); mmCtx.arc(p[0], p[1], 3, 0, Math.PI * 2); mmCtx.fill();
          }
        }
      }
      // Player arrow: white, rotated by yaw (yaw 0 faces -z = map north = up).
      const pp = mmProject(playerState.position.x, playerState.position.z);
      mmCtx.save();
      mmCtx.translate(pp[0], pp[1]);
      mmCtx.rotate(-(playerState.yaw || 0));
      mmCtx.fillStyle = '#f2ead8';
      mmCtx.beginPath();
      mmCtx.moveTo(0, -6); mmCtx.lineTo(4.5, 5); mmCtx.lineTo(-4.5, 5); mmCtx.closePath();
      mmCtx.fill();
      mmCtx.restore();
    },
    setSpread(px) {
      el.crosshair.style.setProperty('--gap', Math.round(px) + 'px');
    },
  };

  el.play.addEventListener('click', () => { if (playFn) playFn(); });
  el.nextRound.addEventListener('click', () => { if (nextFn) nextFn(); });
  el.buyClose.addEventListener('click', () => hud.showBuy(false, null));
  for (const it of items) {
    it.root.addEventListener('click', () => { if (buyFn) buyFn(it.id); });
  }
  return hud;
}
