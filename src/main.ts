import './style.css'
import { Race, type Mode, type Difficulty, type Controls, type RaceEvent } from './race'
import { HighwayWorld } from './world'
import { ArcadeAudio } from './audio'

type State = 'menu' | 'running' | 'paused' | 'gameover'
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const text = (id: string, value: string) => { element(id).textContent = value }
const formatScore = (score: number) => Math.floor(score).toLocaleString('en-US')
const formatDistance = (distance: number) => distance < 1000 ? `${Math.floor(distance)} m` : `${(distance / 1000).toFixed(2)} km`
const audio = new ArcadeAudio()
const keys = new Set<string>()
const touch = new Map<number, string>()
let state: State = 'menu'
let mode: Mode = 'sprint'
let difficulty: Difficulty = 'normal'
let race = new Race(mode, difficulty)
let countdown = 0
let lastCountdown = ''
let toastTime = 0
let hitTime = 0
let hudTime = 0
let accumulator = 0
let lastTime = 0
let frame = 0
let world: HighwayWorld
let disposed = false
const cleanup: (() => void)[] = []

function listen(target: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions) {
  target.addEventListener(event, handler, options)
  cleanup.push(() => target.removeEventListener(event, handler, options))
}

function bestKey() { return `neon-overdrive.best.v1.${mode}.${difficulty}` }
function getBest(): number {
  try {
    const value = Number(localStorage.getItem(bestKey()))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch { return 0 }
}
function updateBest() { text('best-score', formatScore(getBest())) }

function clearControls() {
  keys.clear(); touch.clear()
  document.querySelectorAll('[data-control]').forEach(button => button.classList.remove('active'))
}

function setState(next: State) {
  state = next
  document.body.dataset.state = state
  document.body.dataset.boost = 'false'
  clearControls()
  accumulator = 0
  audio.update(0, false, false, false, 0)
  if (next === 'menu') element('start-btn').focus({ preventScroll: true })
  if (next === 'paused') element('resume-btn').focus({ preventScroll: true })
  if (next === 'gameover') element('restart-btn').focus({ preventScroll: true })
  if (next === 'running' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

function notify(message: string, duration = 2.2) {
  text('toast', message)
  element('toast').classList.add('visible')
  toastTime = duration
}

function start() {
  if (!world) return
  race = new Race(mode, difficulty)
  world.reset()
  countdown = 3.2; lastCountdown = ''; toastTime = 0; hitTime = 0
  element('toast').classList.remove('visible')
  document.body.dataset.hit = 'false'
  text('time-label', mode === 'sprint' ? 'Time left' : 'Survived')
  setState('running')
  updateHUD()
}

function pause() {
  if (state === 'running') setState('paused')
  else if (state === 'paused') setState('running')
}

function menu() {
  race = new Race(mode, difficulty)
  world.reset()
  countdown = 0
  element('countdown').classList.remove('visible')
  setState('menu'); updateBest()
}

function finish() {
  const previousBest = getBest()
  const score = Math.floor(race.score)
  const best = Math.max(previousBest, score)
  let saved = true
  try { localStorage.setItem(bestKey(), String(best)) } catch { saved = false }
  text('result-title', race.completed ? 'NIGHT. CONQUERED.' : 'WHAT A RIDE.')
  text('result-subtitle', `${score > previousBest ? 'New personal best! ' : ''}${race.completed ? 'Sprint complete. Integrity bonus banked.' : 'Out of integrity. The road is calling for a rematch.'}${saved ? '' : ' Local storage unavailable; this record is session-only.'}`)
  text('result-score', formatScore(score))
  text('result-best', formatScore(best))
  text('result-distance', formatDistance(race.distance))
  text('result-nearmisses', String(race.nearMisses))
  text('result-top-speed', `${Math.round(race.topSpeed)} km/h`)
  audio.effect('finish')
  setState('gameover')
}

function events(items: RaceEvent[]) {
  for (const event of items) {
    if (event === 'crash') {
      hitTime = 0.45; world.burst(race.x, true); audio.effect('crash')
      notify('HARD HIT // Keep moving', 1.6)
    } else if (event === 'near') {
      world.burst(race.x); audio.effect('near')
      notify(`${race.boosting ? 'SUPER ' : ''}CLOSE CALL // ×${race.combo} COMBO`)
    } else if (event === 'pickup' || event === 'repair') {
      world.burst(race.x); audio.effect('pickup')
      notify(event === 'repair' ? 'QUICK FIX // +24 INTEGRITY' : 'CHARGED UP // +32 NITRO', 1.3)
    } else if (event === 'edge') notify('GUARDRAIL // Back to the road', 1.8)
    else if (event === 'finish') finish()
  }
}

function input(): Controls {
  const held = new Set(touch.values())
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || held.has('left')
  const right = keys.has('KeyD') || keys.has('ArrowRight') || held.has('right')
  return {
    steer: Number(right) - Number(left),
    brake: keys.has('KeyS') || keys.has('ArrowDown') || held.has('brake'),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || held.has('boost'),
    drift: keys.has('Space') || held.has('drift'),
  }
}

function updateHUD() {
  text('score-value', formatScore(race.score))
  text('speed-value', String(Math.round(race.speed)))
  text('distance-value', formatDistance(race.distance))
  const seconds = Math.max(0, mode === 'sprint' ? Math.ceil(90 - race.time) : Math.floor(race.time))
  text('time-value', mode === 'sprint' ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
  text('combo-value', `×${race.combo}`)
  text('health-value', String(Math.ceil(race.health)))
  element('nitro-fill').style.width = `${race.nitro}%`
  element('health-fill').style.width = `${race.health}%`
  for (const [id, value] of [['nitro-fill', race.nitro], ['health-fill', race.health]] as const) {
    const gauge = element(id).parentElement!
    gauge.setAttribute('role', 'meter'); gauge.setAttribute('aria-valuemin', '0'); gauge.setAttribute('aria-valuemax', '100')
    gauge.setAttribute('aria-valuenow', String(Math.round(value)))
  }
}

async function toggleSound() {
  const enabled = await audio.toggle()
  text('mute-btn', enabled ? 'Sound on' : 'Sound off')
  element('mute-btn').setAttribute('aria-pressed', String(enabled))
}

function bindUI() {
  for (const id of ['start-btn', 'restart-btn', 'pause-restart-btn']) listen(element(id), 'click', start)
  for (const id of ['menu-btn', 'pause-menu-btn']) listen(element(id), 'click', menu)
  for (const id of ['pause-btn', 'resume-btn']) listen(element(id), 'click', pause)
  listen(element('mute-btn'), 'click', () => { void toggleSound() })
  listen(element('fullscreen-btn'), 'click', () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
    void action?.catch(() => { if (state === 'running') notify('Fullscreen unavailable in this browser') })
  })
  if (!document.fullscreenEnabled) element('fullscreen-btn').hidden = true
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => listen(button, 'click', () => {
    mode = button.dataset.mode as Mode
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => {
      const selected = item.dataset.mode === mode
      item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected))
    })
    updateBest()
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(button => listen(button, 'click', () => {
    difficulty = button.dataset.difficulty as Difficulty
    document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(item => {
      const selected = item.dataset.difficulty === difficulty
      item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected))
    })
    updateBest()
  }))
  const gameKeys = ['KeyA', 'KeyD', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space']
  listen(window, 'keydown', raw => {
    const event = raw as KeyboardEvent
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.code === 'Tab' && (state === 'paused' || state === 'gameover')) {
      const dialog = element(state === 'paused' ? 'pause-overlay' : 'results-overlay')
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    if (state === 'running' && gameKeys.includes(event.code)) { event.preventDefault(); keys.add(event.code) }
    if (event.repeat) return
    if (event.code === 'KeyM') { event.preventDefault(); void toggleSound() }
    if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); pause() }
    if (event.code === 'KeyR' && state !== 'menu') { event.preventDefault(); start() }
  })
  listen(window, 'keyup', raw => keys.delete((raw as KeyboardEvent).code))
  listen(window, 'blur', () => { clearControls(); if (state === 'running') pause() })
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { clearControls(); if (state === 'running') pause() }
    lastTime = 0
  })
  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
    listen(button, 'pointerdown', raw => {
      const event = raw as PointerEvent
      event.preventDefault()
      if (state !== 'running') return
      button.setPointerCapture(event.pointerId)
      touch.set(event.pointerId, button.dataset.control!)
      button.classList.add('active')
    })
    const release = (raw: Event) => {
      touch.delete((raw as PointerEvent).pointerId)
      button.classList.remove('active')
    }
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, event, release)
    listen(button, 'contextmenu', event => event.preventDefault())
  })
  listen(world.renderer.domElement, 'webglcontextlost', event => {
    event.preventDefault()
    if (state === 'running') pause()
    showError('The graphics connection was interrupted. Reload this page to restart the engine.')
  })
}

function animate(timestamp: number) {
  if (disposed) return
  frame = requestAnimationFrame(animate)
  const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 1 / 60
  lastTime = timestamp
  if (document.hidden) return
  if (state === 'running') {
    if (countdown > 0) {
      countdown = Math.max(0, countdown - dt)
      const value = countdown > 0.25 ? String(Math.ceil(countdown - 0.25)) : 'GO'
      if (value !== lastCountdown) {
        text('countdown', value); element('countdown').classList.add('visible')
        audio.effect(value === 'GO' ? 'go' : 'countdown')
        lastCountdown = value
      }
      if (!countdown) { element('countdown').classList.remove('visible'); notify('CHASE THE SUN // Shift to boost', 2.5) }
    } else {
      accumulator += dt
      const controls = input()
      while (accumulator >= 1 / 120 && state === 'running') {
        accumulator -= 1 / 120
        events(race.step(1 / 120, controls))
      }
    }
    toastTime = Math.max(0, toastTime - dt)
    hitTime = Math.max(0, hitTime - dt)
    element('toast').classList.toggle('visible', toastTime > 0)
    document.body.dataset.boost = String(race.boosting)
    document.body.dataset.hit = String(hitTime > 0)
  }
  hudTime += dt
  if (hudTime > 0.08) { updateHUD(); hudTime = 0 }
  audio.update(race.speed, race.boosting, race.drifting, state === 'running' && countdown === 0, dt)
  world.render(dt, race, state)
}

function showError(message: string) {
  element('error-panel').hidden = false
  text('error-message', message)
}

try {
  world = new HighwayWorld(element('world'))
  bindUI(); updateBest()
  frame = requestAnimationFrame(animate)
} catch (error) {
  console.error('Unable to initialize the racing engine:', error)
  showError('The 3D engine could not start. Open this page in Chrome, Edge, or Firefox with hardware acceleration enabled, then reload.')
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true; cancelAnimationFrame(frame)
  cleanup.forEach(remove => remove())
  world?.dispose(); audio.dispose()
})
