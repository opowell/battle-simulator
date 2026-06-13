import { GameEngine } from '../engine/index.js';
import { RogueGame  } from '../games/rogue/index.js';
import { HumanAgent } from '../agents/index.js';
import { stepToward  } from '../games/rogue/map.js';

// ── Greedy AI: fight monsters, grab items, descend ────────────────────────────

function makeRogueAgent(id) {
  return {
    id,
    chooseAction(state, legalActions) {
      const gs   = state.gameSpecific;
      const hero = state.units.find(u => u.type === 'rogue' && u.alive);

      // Always attack adjacent monster
      const attack = legalActions.find(a => a.type === 'move' && a.isAttack);
      if (attack) return attack;

      // Eat food when weak/starving
      if (gs.hunger < 400) {
        const eat = legalActions.find(a =>
          a.type === 'use-item' && hero.attrs.inventory[a.payload?.slot]?.type === 'food');
        if (eat) return eat;
      }

      // Drink healing when hurt
      if (hero.hp < hero.maxHp / 2) {
        const drink = legalActions.find(a =>
          a.type === 'use-item' &&
          (hero.attrs.inventory[a.payload?.slot]?.type === 'potion_healing' ||
           hero.attrs.inventory[a.payload?.slot]?.type === 'potion_extra_healing'));
        if (drink) return drink;
      }

      // Descend stairs if standing on them
      const descend = legalActions.find(a => a.type === 'descend-stairs');
      if (descend) return descend;

      const moves = legalActions.filter(a => a.type === 'move' && !a.isAttack);

      // Navigate toward amulet or stairs using BFS pathfinding
      const target = (gs.amuletPos && !gs.hasAmulet) ? gs.amuletPos : gs.stairsDown;
      if (target) {
        const bfsMove = bfsStep(state, moves, target);
        if (bfsMove) return bfsMove;
      }

      // Fallback: random move
      if (moves.length) return moves[Math.floor(Math.random() * moves.length)];
      return legalActions.find(a => a.type === 'end-turn') ?? legalActions[0];
    },
  };
}

// Use stepToward (BFS) to find the best adjacent move toward `target`
function bfsStep(state, moves, target) {
  if (!moves.length || !target) return null;
  const hero = state.units.find(u => u.type === 'rogue' && u.alive);
  const step = stepToward(state.board.tiles, hero.position, target, state.units);
  if (!step) return null;
  return moves.find(m => m.to.x === step.x && m.to.y === step.y) ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const isAuto    = process.argv.includes('--auto');
const isGreedy  = process.argv.includes('--greedy');
const amuletLevel = parseInt(process.argv.find(a => a.startsWith('--level='))?.split('=')[1] ?? '5', 10);

const rogueAgent = (isAuto || isGreedy) ? makeRogueAgent('rogue-ai') : new HumanAgent('Rogue');

const players = [{ id: 'player-1', name: 'The Rogue', agent: rogueAgent }];
const engine  = new GameEngine(RogueGame, players, { amuletLevel, maxTurns: 2000 });

if (isAuto || isGreedy) {
  console.log(`Running Rogue simulation (amulet on level ${amuletLevel})...\n`);
  const { result, finalState } = await engine.run();
  console.log(RogueGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('ROGUE: Dungeons of Doom');
  console.log(`Find the Amulet of Yendor on dungeon level ${amuletLevel}!`);
  console.log('Legend: @=you  >=stairs  "=Amulet  %=food  !=potion  ?=scroll  )=weapon  ]=armor  *=gold\n');

  while (!engine.result) {
    console.log('\n' + RogueGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + RogueGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (rogueAgent instanceof HumanAgent) rogueAgent.close?.();
}
