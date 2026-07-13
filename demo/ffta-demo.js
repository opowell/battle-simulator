import { GameEngine } from '../engine/index.js';
import { FFTAGame }   from '../games/ffta/index.js';
import { ABILITIES }  from '../games/ffta/abilities.js';
import { HumanAgent } from '../agents/index.js';
import { manhattan, attackDirection }  from '../games/ffta/grid.js';

// How much better an attack from `fromPos` lands on `target`, exploiting facing:
// striking the rear (2) beats a flank (1) beats a front hit (0).
const SIDE_RANK = { back: 2, side: 1, front: 0 };
const facingRank = (fromPos, target) => SIDE_RANK[attackDirection(fromPos, target.position, target.facing)];

// Pull the numeric damage estimate out of an ability action's preview string
// (e.g. "17-24 dmg (REAR +50%)" → 24). The preview already folds in the facing,
// height and elemental multipliers, so ranking by it lets the agent exploit them
// all at once. Returns null for previews without a number (e.g. AoE "×2").
function previewDamage(preview) {
  const m = /(?:~)?(\d+)(?:-(\d+))?\s*dmg/.exec(preview ?? '');
  if (!m) return null;
  const lo = +m[1];
  return { lo, hi: m[2] ? +m[2] : lo };
}

// ── Greedy agent ──────────────────────────────────────────────────────────────
// Priority: kill blow > biggest hit (favouring flank/rear) > heal hurt ally > close on
// the nearest enemy's back > end turn facing the nearest enemy

const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    const myId = state.activePlayers[0];
    const { activeUnitId } = state.gameSpecific;
    const activeUnit = state.units.find(u => u.id === activeUnitId);
    const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);

    // Use a damaging ability — prefer the one that would kill, then lowest-HP target
    const damageAbilities = legalActions.filter(a => {
      if (a.type !== 'ability') return false;
      return ABILITIES[a.abilityName]?.effect.includes('damage');
    });
    if (damageAbilities.length) {
      const score = (a) => {
        const t = state.units.find(u => u.id === a.targetId);
        const d = previewDamage(a.preview);
        // AoE / unpreviewable hits: keep the old low-HP-target tie-break, ranked
        // below any single-target hit with a real damage estimate.
        if (!d || !t) return -(t?.hp ?? 999);
        // A guaranteed kill outweighs a possible one, which outweighs raw damage —
        // and the estimate already carries the flank/rear bonus, so the agent
        // naturally strikes the enemy it is standing behind.
        const kill = d.lo >= t.hp ? 2000 : d.hi >= t.hp ? 1000 : 0;
        return kill + (d.lo + d.hi) / 2;
      };
      return damageAbilities.reduce((best, a) => score(a) > score(best) ? a : best);
    }

    // Heal a hurt ally (< 60% HP)
    const healAbilities = legalActions.filter(a =>
      a.type === 'ability' && ABILITIES[a.abilityName]?.effect === 'heal'
    );
    if (healAbilities.length) {
      const best = healAbilities.reduce((best, a) => {
        const t = state.units.find(u => u.id === a.targetId);
        const b = state.units.find(u => u.id === best.targetId);
        return (t?.hp / t?.maxHp ?? 1) < (b?.hp / b?.maxHp ?? 1) ? a : best;
      });
      const t = state.units.find(u => u.id === best.targetId);
      if (t && t.hp / t.maxHp < 0.6) return best;
    }

    // Apply a useful status ability
    const statusAbilities = legalActions.filter(a =>
      a.type === 'ability' && ABILITIES[a.abilityName]?.effect === 'status'
    );
    if (statusAbilities.length) return statusAbilities[0];

    // Move toward nearest enemy (or toward wounded ally if healer)
    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length && activeUnit) {
      if (enemies.length) {
        const nearest = enemies.reduce((best, e) =>
          manhattan(activeUnit.position, e.position) < manhattan(activeUnit.position, best.position) ? e : best
        );
        // Close the distance first; among equally-close tiles, prefer one that
        // puts us on the enemy's flank or back for the facing bonus next turn.
        return moves.reduce((best, m) => {
          const md = manhattan(m.to, nearest.position);
          const bd = manhattan(best.to, nearest.position);
          if (md !== bd) return md < bd ? m : best;
          return facingRank(m.to, nearest) > facingRank(best.to, nearest) ? m : best;
        });
      }
    }

    // End turn: face the nearest enemy if one is known, else keep current facing
    const endTurns = legalActions.filter(a => a.type === 'end-turn');
    if (endTurns.length > 1 && activeUnit && enemies.length) {
      const nearest = enemies.reduce((best, e) =>
        manhattan(activeUnit.position, e.position) < manhattan(activeUnit.position, best.position) ? e : best
      );
      const dx = nearest.position.x - activeUnit.position.x;
      const dy = nearest.position.y - activeUnit.position.y;
      // Facing keys are the isometric screen diagonals (see FFTAGame DIRECTIONS):
      // grid +x → SE, −x → NW, +y → SW, −y → NE.
      const wantDir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'SE' : 'NW') : (dy >= 0 ? 'SW' : 'NE');
      return endTurns.find(a => a.direction === wantDir) ?? endTurns[0];
    }
    return endTurns[0];
  },
};

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      const endTurns = legalActions.filter(a => a.type === 'end-turn');
      const others   = legalActions.filter(a => a.type !== 'end-turn');
      const pool = [...endTurns, ...endTurns, ...endTurns, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('Marche\'s Clan');
const agent2  = isGreedy ? GreedyAgent : makeRandom();

const players = [
  { id: 'player-1', name: "Marche's Clan",  agent: agent1 },
  { id: 'player-2', name: 'Judges\' Clan',  agent: agent2 },
];

const engine = new GameEngine(FFTAGame, players, { maxTurns: 200 });

// ── Run ───────────────────────────────────────────────────────────────────────

if (isAuto) {
  console.log('Running FFTA simulation…\n');
  const { result, finalState } = await engine.run();
  console.log(FFTAGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Final Fantasy Tactics Advance');
  console.log('You command player-1 (Uppercase symbols).  Computer commands player-2 (lowercase).');
  console.log('');
  console.log('Jobs:  S=Soldier  W=White Mage  A=Archer  T=Thief  F=Fighter  B=Black Mage');
  console.log('Map:   #=wall  .=grass  1=elevated(h1,+20%atk per h above target)  2=high(h2)');
  console.log('');
  console.log('Each unit can Move and/or use one Ability per turn, then End Turn.');
  console.log('Units act in order of Speed (fastest first).');
  console.log('');

  while (!engine.result) {
    console.log('\n' + FFTAGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + FFTAGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close();
}
