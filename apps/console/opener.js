// opener.js — where a session opens: a browser tab of its own, or a tab of the
// console's window beside the browser, as the `sessionsInNewTab` setting says.
//
// The console provides OPEN_SESSION (App.vue); anything that opens a session
// goes through useSessionOpener() rather than linking to the play UI itself.

import { inject } from 'vue'
import { playUrl } from './api.js'
import { settings } from './settings.js'

export const OPEN_SESSION = Symbol('open-session')

export function useSessionOpener() {
  const openHere = inject(OPEN_SESSION, null)
  const inNewTab = () => settings.sessionsInNewTab || !openHere

  /**
   * Call while the click still counts as one, before awaiting anything: a
   * browser tab has to be opened now or a popup blocker stops it once the
   * session exists. `go(id)` then points it at the session; `cancel()` closes
   * it when there turned out to be none.
   */
  function begin() {
    if (!inNewTab()) return { go: (id) => openHere(id), cancel() {} }
    const tab = window.open('', '_blank')
    return {
      go(id) { if (tab) { tab.opener = null; tab.location.href = playUrl.session(id) } },
      cancel() { tab?.close() },
    }
  }

  return {
    inNewTab,
    begin,
    open: (id) => begin().go(id),
    /**
     * For a link to a session: the browser follows it into a tab of its own
     * when sessions open in one, or when the press asked for one (⌘, Ctrl, ⇧,
     * a middle click); otherwise it opens here.
     */
    follow(event, id) {
      if (inNewTab() || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      openHere(id)
    },
  }
}
