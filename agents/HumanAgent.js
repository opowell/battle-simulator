import * as readline from 'node:readline';

/**
 * Interactive agent — prints legal actions and reads a numbered choice from stdin.
 * chooseAction is async (awaits readline).
 */
export class HumanAgent {
  constructor(name = 'Human') {
    this.id = 'human';
    this.name = name;
    this._rl = null;
  }

  _rl_get() {
    if (!this._rl) {
      this._rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return this._rl;
  }

  async chooseAction(_state, legalActions) {
    console.log('\nLegal actions:');
    legalActions.forEach((a, i) => {
      const desc = formatAction(a);
      console.log(`  [${i}] ${desc}`);
    });

    return new Promise((resolve) => {
      this._rl_get().question(`\nChoose (0–${legalActions.length - 1}): `, (answer) => {
        const idx = parseInt(answer, 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < legalActions.length) {
          resolve(legalActions[idx]);
        } else {
          console.log('Invalid — picking first action.');
          resolve(legalActions[0]);
        }
      });
    });
  }

  close() {
    if (this._rl) { this._rl.close(); this._rl = null; }
  }
}

function formatAction(a) {
  if (a.type === 'move' && a.from && a.to) {
    const cap = a.isCapture ? ` x${a.targetId}` : '';
    const promo = a.payload?.promote ? `=${a.payload.promote[0].toUpperCase()}` : '';
    return `${a.unitId}: ${a.from}→${a.to}${cap}${promo}`;
  }
  if (a.type === 'castle') return `Castle ${a.side}`;
  if (a.type === 'attack') return `${a.unitId} attacks ${a.targetId}`;
  if (a.type === 'play-card') return `Play ${a.payload?.card} (hand[${a.payload?.handIndex}])`;
  if (a.type === 'end-turn') return 'End turn';
  return JSON.stringify(a);
}
