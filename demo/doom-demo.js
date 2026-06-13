import { GameEngine } from '../engine/index.js';
import { DoomGame }   from '../games/doom/index.js';
import { HumanAgent } from '../agents/index.js';
import { WEAPONS }    from '../games/doom/weapons.js';
import { manhattan }  from '../games/doom/map.js';

// ── Marine agent — shoot weakest visible enemy, otherwise advance ─────────────

function makeMarineAgent(id) {
  return {
    id,
    chooseAction(state, legalActions) {
      const demons  = state.units.filter(u => u.alive && u.ownerId === 'demon');
      const marine  = state.units.find(u => u.alive && u.ownerId === 'marine');

      // Shoot: prefer lowest-HP demon in range
      const shoots = legalActions.filter(a => a.type === 'shoot');
      if (shoots.length) {
        return shoots.reduce((best, a) => {
          const ta = state.units.find(u => u.id === a.targetId);
          const tb = state.units.find(u => u.id === best.targetId);
          return (ta?.hp ?? 999) < (tb?.hp ?? 999) ? a : best;
        });
      }

      const moves = legalActions.filter(a => a.type === 'move');

      // Move toward nearest uncollected item if health is low
      if (marine && marine.hp < 60) {
        const items = state.gameSpecific.items.filter(it => !it.pickedUp &&
          (it.type === 'medkit' || it.type === 'health-bonus' || it.type === 'armor-vest'));
        if (items.length && moves.length) {
          const best = moves.reduce((bst, m) => {
            const dA = Math.min(...items.map(it => manhattan(m.to, { x: it.x, y: it.y })));
            const dB = Math.min(...items.map(it => manhattan(bst.to, { x: it.x, y: it.y })));
            return dA < dB ? m : bst;
          });
          if (best) return best;
        }
      }

      // Move toward nearest weapon upgrade if pistol
      if (marine && marine.weapon === 'pistol') {
        const wpnItems = state.gameSpecific.items.filter(it => !it.pickedUp && it.type.includes('-pickup'));
        if (wpnItems.length && moves.length) {
          const best = moves.reduce((bst, m) => {
            const dA = Math.min(...wpnItems.map(it => manhattan(m.to, { x: it.x, y: it.y })));
            const dB = Math.min(...wpnItems.map(it => manhattan(bst.to, { x: it.x, y: it.y })));
            return dA < dB ? m : bst;
          });
          if (best) return best;
        }
      }

      // Move toward nearest demon
      if (moves.length && demons.length) {
        return moves.reduce((bst, m) => {
          const dA = Math.min(...demons.map(e => manhattan(m.to, e.position)));
          const dB = Math.min(...demons.map(e => manhattan(bst.to, e.position)));
          return dA < dB ? m : bst;
        });
      }

      return legalActions.find(a => a.type === 'skip-unit')
          ?? legalActions.find(a => a.type === 'end-turn');
    },
  };
}

// ── Demon agent — attack marine if in range, otherwise close in ───────────────

function makeDemonAgent(id) {
  return {
    id,
    chooseAction(state, legalActions) {
      const marines = state.units.filter(u => u.alive && u.ownerId === 'marine');

      const shoots = legalActions.filter(a => a.type === 'shoot');
      if (shoots.length) return shoots[0];

      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length && marines.length) {
        return moves.reduce((bst, m) => {
          const dA = Math.min(...marines.map(e => manhattan(m.to, e.position)));
          const dB = Math.min(...marines.map(e => manhattan(bst.to, e.position)));
          return dA < dB ? m : bst;
        });
      }

      return legalActions.find(a => a.type === 'skip-unit')
          ?? legalActions.find(a => a.type === 'end-turn');
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const isAuto = process.argv.includes('--auto');

const agent1 = isAuto ? makeMarineAgent('marine-ai') : new HumanAgent('Marine');
const agent2 = makeDemonAgent('demon-ai');

const players = [
  { id: 'player-1', name: 'Doomguy',  agent: agent1 },
  { id: 'player-2', name: 'The Horde', agent: agent2 },
];

const engine = new GameEngine(DoomGame, players);

if (isAuto) {
  console.log('Running Doom simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(DoomGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('DOOM (turn-based) — You command the marine. The demons are AI-controlled.');
  console.log('Find weapons and ammo throughout the map. Kill every demon to win.');
  console.log('Legend: @=Marine  z=Zombie g=Shotgunner i=Imp D=Demon C=Cacodemon B=Baron');
  console.log('        +=health  a=armor  s=shotgun  c=chaingun  r=rocket  p=plasma  $=ammo\n');

  while (!engine.result) {
    console.log('\n' + DoomGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + DoomGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
