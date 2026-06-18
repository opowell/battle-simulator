import * as readline from 'node:readline';
import { formatAction } from '../games/formatAction.js';

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
