/**
 * Agent that suspends chooseAction until an external caller submits an action
 * via submit(). Used by the HTTP API server.
 */
export class ApiAgent {
  constructor(playerId) {
    this.id = `api:${playerId}`;
    this._pending = null; // { resolve, reject, legalActions }
    // Optional hook fired when this agent starts waiting for input, so the
    // Session can push the "your turn" state to WebSocket clients. The engine
    // is parked inside `await chooseAction(...)` at that moment, so there is no
    // other place to observe the transition into a pending human turn.
    this.onPending = null;
  }

  async chooseAction(_state, legalActions) {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject, legalActions };
      if (this.onPending) { try { this.onPending(); } catch {} }
    });
  }

  /** Returns { legalActions } if waiting for input, null otherwise. */
  get pending() {
    return this._pending ? { legalActions: this._pending.legalActions } : null;
  }

  submit(action) {
    if (!this._pending) throw new Error('No action pending for this player');
    const { resolve } = this._pending;
    this._pending = null;
    resolve(action);
  }

  abort(reason = 'Session closed') {
    if (this._pending) {
      const { reject } = this._pending;
      this._pending = null;
      reject(new Error(reason));
    }
  }
}
