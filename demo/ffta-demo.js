import { GameEngine } from '../engine/index.js';
import { FFTAGame }   from '../games/ffta/index.js';
import { ABILITIES }  from '../games/ffta/abilities.js';
import { HumanAgent } from '../agents/index.js';
import { manhattan }  from '../games/ffta/grid.js';

// ── Greedy agent ──────────────────────────────────────────────────────────────
// Priority: kill blow > damage lowest-HP enemy > heal hurt ally > move toward nearest enemy > end turn

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
      const best = damageAbilities.reduce((best, a) => {
        const t = state.units.find(u => u.id === a.targetId);
        const b = state.units.find(u => u.id === best.targetId);
        return (t?.hp ?? 999) < (b?.hp ?? 999) ? a : best;
      });
      return best;
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
        return moves.reduce((best, m) =>
          manhattan(m.to, nearest.position) < manhattan(best.to, nearest.position) ? m : best
        );
      }
    }

    return legalActions.find(a => a.type === 'end-turn');
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
