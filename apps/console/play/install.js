// install.js — what the game screen expects of the app it runs in. Its components
// use three small atoms without importing them, and their templates read a few of
// the classic scripts' globals (data.js, teamSprite.js, exactNumber.js, vision.js)
// as if they were the component's own — Vue templates resolve a bare name through
// the component, never through window, so those are handed to every component here.
//
// Render functions rather than template strings: the console runs Vue's runtime-only
// build, which has no compiler to turn a string into one.
import { h, reactive } from 'vue'
import { PlayOverlay } from './sessionScope.js'

const BsIcon = {
  props: { name: String, size: { default: 18 }, color: { default: 'currentColor' }, stroke: { default: 1.7 } },
  setup(props) {
    return () => h('svg', {
      width: props.size, height: props.size, viewBox: '0 0 24 24', fill: 'none',
      stroke: props.color, 'stroke-width': props.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, [h('path', { d: ICON_PATHS[props.name] || ICON_PATHS.grid })])
  },
}

const BsDot = {
  props: { color: String, size: { default: 9 } },
  setup(props) {
    return () => h('span', {
      class: 'dot',
      style: { background: props.color, width: props.size + 'px', height: props.size + 'px', boxShadow: '0 0 8px -1px ' + props.color },
    })
  },
}

const BsBadge = {
  props: ['agent'],
  setup(props) {
    return () => props.agent === 'human' ? h('span', { class: 'badge badge-human' }, 'human')
      : props.agent === 'open' ? h('span', { class: 'badge badge-open' }, 'open')
      : h('span', { class: 'badge badge-ai' }, 'AI')
  },
}

export function installPlay(app) {
  // The tinted-sprite cache, made reactive so a sprite repaints once its tint is ready.
  window.teamSpriteReactive(reactive)
  Object.assign(app.config.globalProperties, {
    ICON_PATHS, RDR,
    computeUnits, makeFitter,
    samplePath, lerp,
    teamSpriteHref,
    EXACT,
    VISION,
  })
  app.component('BsIcon', BsIcon)
  app.component('BsDot', BsDot)
  app.component('BsBadge', BsBadge)
  app.component('PlayOverlay', PlayOverlay)
}
