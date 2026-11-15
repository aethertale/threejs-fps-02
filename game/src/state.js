// state.js — EMBERLINE match state factory (module C).
// Single source of truth for round/match/economy/bomb state. Plain data only:
// no scene, no DOM, no imports. round.js / objective.js mutate these fields;
// main.js reads them for HUD + win checks.
export function createState() {
  return {
    time: 0,
    phase: 'buy', // 'buy' | 'live' | 'end' | 'match'
    round: 1,
    score: { you: 0, foe: 0 },
    money: 800,
    timer: 15, // seconds left in the current phase (buy 15, live 100, end 5)
    playerHealth: 100,
    playerArmor: 0,
    playerAlive: true,
    bomb: {
      status: 'idle', // idle | planting | planted | defusing | detonated | defused
      site: null, // 'A' | 'B' | null
      progress: 0, // 0..1 plant/defuse progress
      timer: 0, // seconds to detonation once planted (35)
    },
    owned: { shotgun: false, grenades: 0, armor: false },
    kills: 0,
    deaths: 0,
    result: null, // { win, reason, award } — set at round end
    matchWinner: null, // 'you' | 'foe' | null
  };
}
