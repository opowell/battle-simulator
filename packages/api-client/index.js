export class BattleSimClient {
  constructor(base = 'http://localhost:3333') {
    this.base = base;
  }

  async _req(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }

  listGames()                          { return this._req('GET', '/games'); }
  createSession(game, players, config) { return this._req('POST', '/sessions', { game, players, config }); }
  listSessions()                       { return this._req('GET', '/sessions'); }
  getSession(id, playerId)             { return this._req('GET', `/sessions/${id}${playerId ? `?player=${encodeURIComponent(playerId)}` : ''}`); }
  getState(id, playerId)               { return this._req('GET', `/sessions/${id}/state${playerId ? `?player=${encodeURIComponent(playerId)}` : ''}`); }
  submitAction(id, playerId, action)   { return this._req('POST', `/sessions/${id}/action`, { playerId, action }); }
  deleteSession(id)                    { return this._req('DELETE', `/sessions/${id}`); }
}
