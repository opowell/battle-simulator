// api.js — HTTP client for the Battle Simulator API

const _BASE = 'http://localhost:3333';

async function _req(path, opts) {
  const r = await fetch(_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

window.api = {
  games:    ()                      => _req('/games'),
  sessions: ()                      => _req('/sessions'),
  session:  (id, player)             => _req('/sessions/' + id + (player ? '?player=' + player : '')),
  history:  (id)                    => _req('/sessions/' + id + '/history'),
  log:      (id)                    => _req('/sessions/' + id + '/log'),
  create:   (body)                  => _req('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  action:   (id, playerId, action)  => _req('/sessions/' + id + '/action', { method: 'POST', body: JSON.stringify({ playerId, action }) }),
  del:      (id)                    => _req('/sessions/' + id, { method: 'DELETE' }),
};
