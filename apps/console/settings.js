// settings.js — the console's own preferences, kept in this browser.
//
// Each setting is also a record in the catalog (the `settings` entity), so it is
// found and changed the way anything else is: by querying for it and opening it.
// Values live in localStorage; a browser that refuses storage (a private window,
// blocked site data) gets the defaults, and changes then last until the reload.

import { reactive } from 'vue'

const STORAGE_KEY = 'battle-simulator.console.settings'

const yesNo = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]

export const SETTINGS = [
  {
    key: 'sessionsInNewTab',
    label: 'Open sessions in new tab',
    description: 'Yes opens a session in a new browser tab. No opens it here, in a tab beside the console.',
    choices: yesNo,
    default: false,
  },
]

function stored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {} } catch { return {} }
}

function read() {
  const saved = stored()
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.key in saved ? saved[s.key] : s.default]))
}

export const settings = reactive(read())

export function setSetting(key, value) {
  settings[key] = value
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings })) } catch {}
}

/** What a setting's value reads as: its choice's label. */
export const settingText = (def, value) => def.choices.find((c) => c.value === value)?.label ?? String(value)

// Another console tab changed one: follow it.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) Object.assign(settings, read())
})
