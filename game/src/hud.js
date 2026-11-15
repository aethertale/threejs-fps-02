// DOM HUD only: never touches the simulation. main.js pushes numbers in,
// reads play / buy / next-round callbacks out. Writes are cached so per-frame
// refresh calls from main.js do not churn the DOM.
const $ = (id) => document.getElementById(id);

const BUY = [
  { id: 'shotgun', name: 'BREACH-12', price: 600 },
  { id: 'grenade', name: 'SPARK-9', price: 300 },
  { id: 'armor', name: 'PLATE VEST', price: 400 },
  { id: 'ammo', name: 'AMMO REFILL', price: 200 },
];

export function createHud() {
  const el = {};
  for (const id of ['hud', 'crosshair', 'hitmarker', 'health', 'health-num', 'armor',
    'ammo', 'ammo-mag', 'ammo-reserve', 'weapon-name', 'money', 'timer', 'score',
    'score-you', 'score-foe', 'round-num', 'kills', 'objective', 'caption', 'feed',
    'plant-bar', 'plant-fill', 'buy-menu', 'buy-close', 'overlay', 'overlay-title',
    'overlay-copy', 'play', 'next-round', 'keys', 'damage-vignette', 'down-banner']) {
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
        state.owned.grenades + '|' + state.owned.armor : '');
      el.buyMenu.hidden = !visible;
      if (!visible || sig === lastBuySig) return;
      lastBuySig = sig;
      for (const it of items) {
        let owned = false, label = '';
        if (it.id === 'shotgun') owned = !!state.owned.shotgun;
        if (it.id === 'armor') owned = !!state.owned.armor;
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
