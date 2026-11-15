// round.js — EMBERLINE round phase machine + economy (module C).
// Imports nothing from bots.js / objective.js: it only reads plain
// numbers (foesAlive, alliesAlive, playerAlive, bombStatus) via ctx.
// Owns: buy 15 s -> live 100 s -> end 5 s, rewards, match end (first to 5, max 9).
export function createRound(state) {
  const PRICES = { shotgun: 600, smg: 900, grenade: 300, armor: 400, ammo: 200 };
  const BUY_TIME = 15;
  const LIVE_TIME = 100;
  const END_TIME = 5;
  const WIN_ROUNDS = 5;
  const MAX_ROUNDS = 9;
  const GRENADE_CAP = 2;

  let _ctx = null;

  function fire(name, arg) {
    if (_ctx && typeof _ctx[name] === 'function') _ctx[name](arg);
  }

  function phaseTo(phase, timer) {
    state.phase = phase;
    state.timer = timer;
    fire('onPhase', phase);
  }

  function toLive() {
    phaseTo('live', LIVE_TIME);
  }

  function endRoundInternal(win, reason) {
    if (state.phase !== 'live') return;
    const award = win ? 1200 : 600;
    state.money += award;
    if (win) state.score.you += 1;
    else state.score.foe += 1;
    state.result = { win, reason, award };
    if (state.score.you >= WIN_ROUNDS || state.score.foe >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.score.you > state.score.foe ? 'you' : 'foe';
    }
    phaseTo('end', END_TIME);
    fire('onRoundEnd', state.result);
  }

  return {
    step(dt, ctx) {
      _ctx = ctx || _ctx;
      if (!ctx) return;
      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) toLive();
        return;
      }
      if (state.phase === 'live') {
        // Terminal outcomes first: a detonation / defuse / elimination
        // landing on the same tick as the deadline must win over timeout.
        if (ctx.bombStatus === 'detonated') {
          endRoundInternal(true, 'CHARGE DETONATED');
        } else if (ctx.bombStatus === 'defused') {
          endRoundInternal(false, 'CHARGE DEFUSED');
        } else if (ctx.foesAlive === 0) {
          endRoundInternal(true, 'ALL WARDENS DOWN');
        } else if (!ctx.playerAlive && ctx.alliesAlive === 0 &&
                   ctx.bombStatus !== 'planted' && ctx.bombStatus !== 'defusing') {
          // Squad wiped while the charge is live: the round is NOT over —
          // the bomb still ticks (detonation wins) and foes can still defuse.
          endRoundInternal(false, 'SQUAD DOWN');
        } else if (ctx.bombStatus !== 'planted' && ctx.bombStatus !== 'defusing') {
          state.timer -= dt;
          if (state.timer <= 0) endRoundInternal(false, 'TIME EXPIRED — NO PLANT');
        }
        return;
      }
      if (state.phase === 'end') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.matchWinner) {
            state.phase = 'match';
            state.timer = 0;
            fire('onPhase', 'match');
            fire('onMatchEnd', state.matchWinner);
          } else if (_ctx && typeof _ctx.onNextRound === 'function') {
            // One round-start callback for automatic AND manual advance:
            // the handler resets the world (see main.js advanceRound).
            fire('onNextRound');
          } else {
            this.nextRound();
          }
        }
        return;
      }
      // phase 'match': terminal, waits for resetMatch() via PLAY AGAIN
    },

    startRound() {
      state.playerHealth = 100;
      state.playerAlive = true;
      state.result = null;
      state.bomb.status = 'idle';
      state.bomb.site = null;
      state.bomb.progress = 0;
      state.bomb.timer = 0;
      phaseTo('buy', BUY_TIME);
    },

    endRound(win, reason) {
      endRoundInternal(win, reason);
    },

    nextRound() {
      state.round += 1;
      this.startRound();
    },

    resetMatch() {
      state.round = 1;
      state.score.you = 0;
      state.score.foe = 0;
      state.money = 800;
      state.kills = 0;
      state.deaths = 0;
      state.headshots = 0;
      state.matchWinner = null;
      state.owned.shotgun = false;
      state.owned.smg = false;
      state.owned.grenades = 0;
      state.owned.armor = false;
      this.startRound();
    },

    // Enter skips the buy phase early.
    skipBuy() {
      if (state.phase === 'buy') toLive();
    },

    buy(item) {
      const price = PRICES[item];
      if (price === undefined) return false;
      if (state.phase !== 'buy') return false;
      if (state.money < price) return false;
      if (item === 'shotgun') {
        if (state.owned.shotgun) return false;
        state.money -= price;
        state.owned.shotgun = true;
        return true;
      }
      if (item === 'smg') {
        if (state.owned.smg) return false;
        state.money -= price;
        state.owned.smg = true;
        return true;
      }
      if (item === 'grenade') {
        if (state.owned.grenades >= GRENADE_CAP) return false;
        state.money -= price;
        state.owned.grenades += 1;
        return true;
      }
      if (item === 'armor') {
        if (state.owned.armor) return false;
        state.money -= price;
        state.owned.armor = true;
        return true;
      }
      // 'ammo': no owned flag in state — the caller refills the arsenal.
      state.money -= price;
      return true;
    },

    addKill() {
      state.kills += 1;
      state.money += 150;
    },

    addPlant() {
      state.money += 300;
    },
  };
}
