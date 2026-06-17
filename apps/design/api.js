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
  session:  (id)                    => _req('/sessions/' + id),
  create:   (body)                  => _req('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  action:   (id, playerId, action)  => _req('/sessions/' + id + '/action', { method: 'POST', body: JSON.stringify({ playerId, action }) }),
  del:      (id)                    => _req('/sessions/' + id, { method: 'DELETE' }),
};
