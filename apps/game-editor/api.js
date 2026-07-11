// api.js — HTTP client for the game-editor admin endpoints. The editor is served
// by the api-server itself, so talk to whatever origin/path prefix loaded the
// page (works on any port, e.g. a throwaway test instance, or embedded under a
// launcher at a path prefix like /battle-simulator).
const _BASE_PATH = window.location.pathname.replace(/\/ui\/.*$/, '');
const _BASE = window.location.origin + _BASE_PATH;

async function _req(path, opts) {
  const r = await fetch(_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || (r.status + ' ' + path));
  return text ? JSON.parse(text) : null;
}

window.editorApi = {
  list:       ()                => _req('/admin/games'),
  create:     (body)            => _req('/admin/games', { method: 'POST', body: JSON.stringify(body) }),
  update:     (name, body)      => _req('/admin/games/' + name, { method: 'PUT', body: JSON.stringify(body) }),
  remove:     (name)            => _req('/admin/games/' + name, { method: 'DELETE' }),
  readFile:   (name, path)      => _req('/admin/games/' + name + '/file?path=' + encodeURIComponent(path)),
  writeFile:  (name, path, content) => _req('/admin/games/' + name + '/file', { method: 'PUT', body: JSON.stringify({ path, content }) }),
};
