/**
 * React binding for the twin. The core runs headless at 20 Hz; the store
 * publishes a snapshot at 12 Hz so the HMI re-renders at a human rate and the
 * physics stays deterministic regardless of frame timing.
 */
import { create } from 'zustand'
import { buildDictionary } from '../ml/dictionary.js'
import { TwinCore } from './twinCore.js'
import { CONFIG, createTelemetryLink, requestInference, mergeInference } from '../ml/backend.js'

const PUBLISH_HZ = 12

export const useTwin = create((set, get) => ({
  booting: true, bootProgress: 0, bootStage: 'starting',
  frame: null, core: null, dict: null,
  view: 'monitor',
  replay: { active: false, index: 0, playing: false, speed: 1 },
  linkStatus: CONFIG.telemetryURL ? 'connecting' : 'local',

  setView: v => set({ view: v }),

  boot: async () => {
    // Yield to the browser between stages so the boot screen actually paints.
    const yieldToUI = () => new Promise(r => setTimeout(r, 0))
    set({ bootStage: 'Generating fault signature dictionary from physics model' })
    await yieldToUI()
    const dict = buildDictionary((p, label) => {
      // Progress arrives synchronously inside one long task; store the latest.
      get()._p = { p, label }
    })
    set({ dict, bootProgress: 1, bootStage: 'ready' })
    const core = new TwinCore(dict)
    core.setMission('manual')
    set({ core, booting: false })

    // ── live telemetry link (no-op when VITE_TELEMETRY_URL is unset) ─────
    const link = createTelemetryLink(CONFIG.telemetryURL, {
      onFrame: f => core.ingestTelemetry(f),
      onStatus: s => set({ linkStatus: s }),
    })
    set({ link })

    // ── served inference (no-op when VITE_INFERENCE_URL is unset) ────────
    let inferBusy = false
    const pollInference = async () => {
      if (!CONFIG.inferenceURL || inferBusy) return
      const payload = core.inferencePayload()
      if (!payload) return
      inferBusy = true
      try {
        const remote = await requestInference(CONFIG.inferenceURL, payload)
        if (remote && core.result) core.result.analysis = mergeInference(core.result.analysis, remote)
      } catch { /* keep the local analytics; the twin degrades, never blanks */ }
      finally { inferBusy = false }
    }
    if (CONFIG.inferenceURL) setInterval(pollInference, 1000 / Math.max(CONFIG.inferenceHz, 0.2))

    let last = performance.now(), acc = 0
    const loop = now => {
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now
      const st = get()
      if (!st.replay.active) {
        core.step(dt)
        acc += dt
        if (acc >= 1 / PUBLISH_HZ) { acc = 0; set({ frame: core.result }) }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  },

  /* ── controls ───────────────────────────────────────────────────────── */
  inject: (id, cyl) => { get().core?.injectFault(id, cyl); set({ frame: get().core.result }) },
  restore: () => { get().core?.restoreBaseline(); set({ frame: get().core.result }) },
  fullReset: () => { get().core?.fullReset(); set({ frame: get().core.result, replay: { active: false, index: 0, playing: false, speed: 1 } }) },
  setCommand: patch => { get().core?.setCommand(patch); },
  setMission: id => { get().core?.setMission(id); set({ frame: get().core.result }) },
  setTimeScale: v => { const c = get().core; if (c) c.timeScale = v },
  setWearScale: v => { const c = get().core; if (c) c.wearScale = v },
  togglePause: () => { const c = get().core; if (c) { c.paused = !c.paused; set({ frame: { ...c.result, paused: c.paused } }) } },

  /* ── mission replay ─────────────────────────────────────────────────── */
  enterReplay: () => {
    const rec = get().core?.record ?? []
    set({ replay: { active: rec.length > 8, index: Math.max(0, rec.length - 1), playing: false, speed: 1 }, view: 'replay' })
  },
  exitReplay: () => set({ replay: { active: false, index: 0, playing: false, speed: 1 } }),
  seekReplay: i => set(s => ({ replay: { ...s.replay, index: i } })),
  playReplay: () => {
    const st = get()
    if (st.replay.playing) return set(s => ({ replay: { ...s.replay, playing: false } }))
    set(s => ({ replay: { ...s.replay, playing: true } }))
    const tick = () => {
      const s = get()
      if (!s.replay.active || !s.replay.playing) return
      const rec = s.core?.record ?? []
      const next = s.replay.index + 1
      if (next >= rec.length) return set(r => ({ replay: { ...r.replay, playing: false } }))
      set(r => ({ replay: { ...r.replay, index: next } }))
      setTimeout(tick, 250 / s.replay.speed)
    }
    setTimeout(tick, 250)
  },
  setReplaySpeed: v => set(s => ({ replay: { ...s.replay, speed: v } })),
}))
