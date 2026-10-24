// plugins.js — what a game adds to the game screen beyond what its toGrid and
// ui.* flags can say: components and sounds that live in the game's own folder.
//
// A game definition lists them as `uiPlugins`, and GET /games hands each one to
// the client with the URL it is served at:
//
//   { id: 'cities', slot: 'overview', label: 'Cities', src: 'ui/CitiesOverlay.vue', url }
//
// The slots, and what each is handed:
//
//   overview     a screen about the whole side (an empire's cities, its research),
//                opened from a button in the Orders panel, which `label` names, or
//                by a ui.keys binding whose `panel` is the plugin's id. A component;
//                props { show, field, playerId, actions }, emits close, submit,
//                goto ({ x, y, unitId }) and select-unit (id). Hidden while
//                ui.empirePanels is false.
//   city-screen  what selecting one of field.cities opens. A component; props
//                { show, city, field, actions, team, recolor }, emits close, submit
//                and select-unit.
//   sound        a plain ES module, any of:
//                  onEntry({ entry, unitsById, at })  per log entry as the board
//                    plays it; at(t, fn) runs fn when playback reaches sim-time t
//                  onSubmit(action)  the viewer gave an order
//
// A component plugin is compiled by the same loader as these files, so it can
// import 'vue' and 'battle-play' (sessionScope.js) by name; the rest of the game
// screen it reaches through window (window.api, window.teamSpriteHref, …) like the
// play UI's own scripts do.
import { defineAsyncComponent, markRaw } from 'vue';

const loaded = new Map();
function load(url) {
  const abs = new URL(window.api.basePath + url, window.location.origin).href;
  if (!loaded.has(abs)) loaded.set(abs, window.loadPlayModule(abs));
  return loaded.get(abs);
}

/** The game's plugins in `slot`, in the order it lists them. */
export function pluginsIn(gameDef, slot) {
  return (gameDef?.uiPlugins ?? []).filter(p => p.slot === slot);
}

// One component per URL, so a plugin asked for again is the same one, not a remount.
const components = new Map();
function componentAt(url) {
  if (!components.has(url)) components.set(url, markRaw(defineAsyncComponent(() => load(url))));
  return components.get(url);
}

/** A component plugin's components, each { id, label, component }. */
export function pluginComponents(gameDef, slot) {
  return pluginsIn(gameDef, slot).map(p => ({ id: p.id, label: p.label ?? p.id, component: componentAt(p.url) }));
}

/** A module plugin's modules, once they have loaded (one that fails is left out). */
export async function pluginModules(gameDef, slot) {
  const mods = await Promise.all(pluginsIn(gameDef, slot).map(p => load(p.url).catch((e) => {
    console.warn(`plugin ${p.id} did not load:`, e);
    return null;
  })));
  return mods.filter(Boolean);
}
