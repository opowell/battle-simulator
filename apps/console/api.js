// api.js — the console's calls to the API server. The console is served by that
// server, so it talks to whatever origin and mount prefix loaded the page.

export const basePath = window.location.pathname.replace(/\/ui\/.*$/, '')
const base = window.location.origin + basePath

async function request(path, init = {}) {
  const response = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try { message = JSON.parse(text).error ?? text } catch {}
    throw new Error(message || `${response.status} ${path}`)
  }
  return text ? JSON.parse(text) : null
}

const json = (method, body) => ({ method, body: JSON.stringify(body) })

export const api = {
  catalog: () => request('/catalog'),
  games: () => request('/games'),

  // Game definitions — the same admin endpoints /ui/game-editor uses.
  updateGame: (name, meta) => request(`/admin/games/${name}`, json('PUT', meta)),
  createGame: (meta) => request('/admin/games', json('POST', meta)),
  deleteGame: (name) => request(`/admin/games/${name}`, { method: 'DELETE' }),
  readFile: (name, path) => request(`/admin/games/${name}/file?path=${encodeURIComponent(path)}`),
  writeFile: (name, path, content) => request(`/admin/games/${name}/file`, json('PUT', { path, content })),

  createSession: (body) => request('/sessions', json('POST', body)),
  deleteSession: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
}

/** Where the play UI shows a session, and where it sets one up for a game. */
export const playUrl = {
  session: (id) => `${basePath}/ui/design/#/session/${encodeURIComponent(id)}`,
  game: (name) => `${basePath}/ui/design/#/game/${encodeURIComponent(name)}`,
}

/** A path the server hands out (`/images/…`), under this page's mount prefix. */
export const asset = (path) => (path ? basePath + path : null)
