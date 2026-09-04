/**
 * DIGITAL TWIN CORE
 *
 * The central intelligence layer. Owns and synchronises, every tick:
 *   • the ACTUAL virtual engine  (faults + wear applied)
 *   • the REFERENCE virtual engine (pristine, same commands) — the model half
 *     of the physics-informed detector
 *   • the cumulative wear/degradation state
 *   • the ML analytics pass and the advisory generator
 *   • the mission recorder that makes post-flight replay possible
 *
 * It runs headless and independent of React so the simulation rate and the
 * render rate are decoupled — the same shape the real system takes, where the
 * twin runs on the edge node and the HMI is just a subscriber.
 */

import { atmosphere, createEngineState, stepEngine, sense } from '../sim/engineModel.js'
import { buildModifiers, FAULT_BY_ID } from '../sim/faults.js'
import { createWear, stepWear, estimateRUL, lifeConsumed } from '../sim/wear.js'
import { Analytics } from '../ml/analytics.js'
import { buildAdvisories } from '../ml/advisory.js'
import { conditionAt, MISSION_BY_ID } from '../sim/missions.js'
import { PARAMS, bandOf } from '../sim/spec.js'

const DT = 0.05                 // 20 Hz physics
const RECORD_HZ = 4
const RECORD_MAX = 7200         // 30 min of mission recording

export class TwinCore {
  constructor(dictionary) {
    this.dict = dictionary
    this.analytics = new Analytics(dictionary)
    this.reset()
  }

  reset(keepWear = false) {
    const amb = atmosphere(3000, 0)
    this.amb = amb
    this.actual = createEngineState(amb)
    this.reference = createEngineState(amb)
    this.wear = keepWear ? this.wear : createWear()
    this.active = []                        // [{id, cyl, intensity, target, ramp_s, armedAt}]
    this.hist = { rpm: [], egtDev: [] }
    this.record = []
    this.alerts = []
    this.bands = {}
    this.t = 0
    this.flightHours = keepWear ? (this.flightHours || 0) : 0
    this.analytics.reset()
    this.command = { throttle: 0.72, alt_m: 3000, isaDev_C: 0, airspeed_ms: 58 }
    this.mission = 'manual'
    this.timeScale = 1
    this.wearScale = 1
    this.paused = false
    this.result = null
    this._recAcc = 0
    this._alertSeq = 0
    this.warmUp()
  }

  /**
   * Fast-forward both engines to a settled running condition before the HMI
   * connects. A twin that comes up cold would spend its first two minutes
   * alarming on start-up transients — real GCS software attaches to an engine
   * that is already running, and so does this one.
   */
  warmUp(secs = 240) {
    const base = { ...this.command, amb: this.amb }
    const mods = buildModifiers([])
    for (let i = 0; i < secs / DT; i++) {
      stepEngine(this.actual, DT, { ...base, mods, wear: this.wear })
      stepEngine(this.reference, DT, { ...base, mods, wear: {} })
    }
    // Seed the detector's history and the band tracker from the warm state so
    // neither sees the start-up as an event.
    for (let i = 0; i < 40; i++) {
      this.hist.rpm.push(this.actual.rpm)
      const mu = this.actual.egt.reduce((a, b) => a + b, 0) / 4
      this.hist.egtDev.push(this.actual.egt.map(v => v - mu))
    }
    const s = this.actual
    const seed = (key, val, label) => { this.bands[label] = bandOf(key, val) }
    s.cht.forEach((v, i) => seed('cht', v, `CHT CYL ${i + 1}`))
    s.egt.forEach((v, i) => seed('egt', v, `EGT CYL ${i + 1}`))
    seed('oilPress', s.oilPress, 'OIL PRESSURE'); seed('oilTemp', s.oilTemp, 'OIL TEMP')
    seed('coolantTemp', s.coolantTemp, 'COOLANT TEMP'); seed('vibration', s.vibration, 'VIBRATION')
    seed('busVolts', s.busVolts, 'BUS VOLTAGE'); seed('knock', s.knock, 'KNOCK INDEX')
    seed('rpm', s.rpm, 'ENGINE RPM'); seed('fuelPress', s.fuelPress, 'FUEL PRESSURE')
    this.pushAlert('ready', 'good', 'TWIN SYNCHRONISED',
      `Virtual engine locked to the physical engine at cruise. Residual monitoring active on ${this.dict.entries.length ? this.dict.features.length : 0} channels.`)
  }

  /* ── fault injection ──────────────────────────────────────────────────── */
  injectFault(id, cyl = null) {
    const def = FAULT_BY_ID[id]
    if (!def) return
    const existing = this.active.find(a => a.id === id)
    if (existing) { this.removeFault(id); return }
    const chosen = def.perCylinder ? (cyl ?? Math.floor(Math.random() * 4)) : 0
    this.active.push({ id, cyl: chosen, intensity: 0, target: 1, ramp_s: def.ramp_s, armedAt: this.t })
    this.pushAlert('fault-armed', 'warning',
      `FAULT INJECTED — ${def.label}${def.perCylinder ? ` (CYL ${chosen + 1})` : ''}`,
      `Degrading to full severity over ${def.ramp_s} s. The detector has not been told.`)
  }

  removeFault(id) {
    const i = this.active.findIndex(a => a.id === id)
    if (i >= 0) { this.active[i].target = 0; this.active[i].ramp_s = Math.min(this.active[i].ramp_s, 6) }
  }

  /** RESTORE BASELINE: clear every fault and let the engine recover. */
  restoreBaseline() {
    for (const a of this.active) { a.target = 0; a.ramp_s = 4 }
    this.pushAlert('baseline', 'good', 'BASELINE RESTORE COMMANDED',
      'All injected faults clearing. Engine returning to nominal; residuals will decay.')
  }

  /** Clear faults AND reset accumulated wear + the mission recording. */
  fullReset() {
    this.reset(false)
    this.pushAlert('reset', 'good', 'TWIN RESET', 'Engine, wear state and mission recording cleared.')
  }

  setCommand(patch) { Object.assign(this.command, patch) }

  /**
   * Ingest one live telemetry frame (see the contract in src/ml/backend.js).
   * Channels present in the frame overwrite the local model's state; channels
   * absent keep the model's own estimate, so a partial DBC still produces a
   * complete twin. The REFERENCE engine is never overwritten — it keeps running
   * the clean physics on the frame's commanded condition, which is exactly what
   * makes the residual meaningful against live data.
   */
  ingestTelemetry(frame) {
    if (!frame || typeof frame !== 'object') return
    this.external = { at: this.t, frame }
    const a = this.actual
    const num = (k, t = a) => { const v = frame[k]; if (typeof v === 'number' && Number.isFinite(v)) t[k] = v }
    const arr = k => {
      const v = frame[k]
      if (Array.isArray(v)) for (let i = 0; i < Math.min(v.length, a[k].length); i++) {
        if (typeof v[i] === 'number' && Number.isFinite(v[i])) a[k][i] = v[i]
      }
    }
    for (const k of ['rpm', 'propRPM', 'map', 'boost', 'oilPress', 'oilTemp', 'coolantTemp',
      'fuelFlow', 'fuelPress', 'lambda', 'injDuration', 'injTiming', 'knock', 'vibration',
      'busVolts', 'altCurrent', 'turboRPM', 'power', 'torque']) num(k)
    arr('cht'); arr('egt'); arr('vibSpectrum')
    for (const k of ['alt_m', 'isaDev_C', 'airspeed_ms', 'throttle']) {
      if (typeof frame[k] === 'number') this.command[k] = frame[k]
    }
    const mean = x => x.reduce((p, q) => p + q, 0) / x.length
    a.chtMean = mean(a.cht); a.egtMean = mean(a.egt)
    a.egtSpread = Math.max(...a.egt) - Math.min(...a.egt)
    a.chtSpread = Math.max(...a.cht) - Math.min(...a.cht)
  }

  /** True while live frames are arriving; the twin reverts to its own model
   *  (the edge fallback) if the link goes quiet for more than two seconds. */
  get liveIngest() { return !!this.external && this.t - this.external.at < 2 }

  /** Payload for a served inference call. */
  inferencePayload() {
    const a = this.result?.analysis
    if (!a) return null
    return {
      features: a.features,
      residuals: Object.fromEntries(this.dict.features.map((k, i) => [k, a.z[i]])),
      window: [],
    }
  }
  setMission(id) {
    this.mission = id
    this.missionT = 0
    const m = MISSION_BY_ID[id]
    if (m) this.pushAlert('mission', 'good', `MISSION PROFILE — ${m.name}`, m.blurb)
  }

  pushAlert(kind, band, title, detail) {
    this.alerts.unshift({
      id: ++this._alertSeq, kind, band, title, detail,
      t: this.t, wall: Date.now(),
    })
    if (this.alerts.length > 60) this.alerts.pop()
  }

  /* ── main loop ────────────────────────────────────────────────────────── */
  step(wallDt) {
    if (this.paused) return this.result
    // Fixed-timestep accumulator. A 60 Hz frame is 16.7 ms and the physics step
    // is 50 ms, so rounding per-frame would discard the remainder and the
    // simulation would barely advance; the leftover has to carry over.
    this._acc = (this._acc || 0) + wallDt * this.timeScale
    let n = 0
    while (this._acc >= DT && n < 60) { this.tick(DT); this._acc -= DT; n++ }
    if (this._acc > 1) this._acc = 1        // never try to catch up after a stall
    return this.result
  }

  tick(dt) {
    this.t += dt
    this.flightHours += (dt * this.wearScale) / 3600

    /* Flight condition: mission profile, or operator command in manual mode. */
    const m = MISSION_BY_ID[this.mission]
    let cond = this.command
    if (m?.legs) {
      this.missionT = (this.missionT || 0) + dt
      const c = conditionAt(m, this.missionT)
      cond = c
      this.legName = c.legName
      this.missionProgress = c.progress
      Object.assign(this.command, {
        throttle: c.throttle, alt_m: c.alt_m, isaDev_C: c.isaDev_C, airspeed_ms: c.airspeed_ms,
      })
    } else { this.legName = 'Manual'; this.missionProgress = null }

    /* Fault severity ramps. */
    for (const a of this.active) {
      const rate = dt / Math.max(a.ramp_s, 0.5)
      a.intensity += Math.sign(a.target - a.intensity) * rate
      if (Math.abs(a.target - a.intensity) < rate) a.intensity = a.target
    }
    const cleared = this.active.filter(a => a.target === 0 && a.intensity <= 0)
    if (cleared.length) this.active = this.active.filter(a => !cleared.includes(a))

    /* Physics: actual and reference twins, same commands. */
    this.amb = atmosphere(cond.alt_m, cond.isaDev_C)
    const mods = buildModifiers(this.active)
    const refMods = buildModifiers([])
    const base = { throttle: cond.throttle, alt_m: cond.alt_m, isaDev_C: cond.isaDev_C, airspeed_ms: cond.airspeed_ms, amb: this.amb }
    // With a live link the physical engine IS the actual state, so only the
    // reference twin is integrated. Without one, both are.
    if (!this.liveIngest) stepEngine(this.actual, dt, { ...base, mods, wear: this.wear })
    // The reference carries the SAME accumulated wear as the real engine: it is
    // "this engine, at this age, with no fault". A pristine reference would
    // slowly turn normal ageing into a permanent false alarm as hours build up.
    // Wear is monitored on its own path, by the health index and RUL.
    stepEngine(this.reference, dt, { ...base, mods: refMods, wear: this.wear })

    /* Degradation. */
    stepWear(this.wear, dt, this.actual, this.active, this.wearScale)

    /* What the CAN bus reports. */
    const sensed = sense(this.actual, mods)
    this.hist.rpm.push(sensed.rpm)
    const em = sensed.egt.reduce((a, b, i) => a + (b ?? this.reference.egt[i]), 0) / sensed.egt.length
    this.hist.egtDev.push(sensed.egt.map((v, i) => (v ?? this.reference.egt[i]) - em))
    if (this.hist.rpm.length > 40) { this.hist.rpm.shift(); this.hist.egtDev.shift() }

    /* ML pass. */
    const rul = estimateRUL(this.wear)
    const a = this.analytics.update(sensed, this.reference, this.wear, rul, this.hist, dt)
    const advisories = buildAdvisories(a, this.wear, rul, this.t)

    this.trackBands(sensed, a)
    this.result = {
      t: this.t, flightHours: this.flightHours,
      sensed, truth: this.actual, reference: this.reference,
      cond: { ...cond }, legName: this.legName, missionProgress: this.missionProgress,
      analysis: a, advisories, rul, wear: { ...this.wear },
      life: lifeConsumed(this.wear),
      active: this.active.map(x => ({ ...x })),
      alerts: this.alerts.slice(0, 24),
      mission: this.mission, paused: this.paused, timeScale: this.timeScale, wearScale: this.wearScale,
      live: this.liveIngest,
    }

    /* Mission recorder. */
    this._recAcc += dt
    if (this._recAcc >= 1 / RECORD_HZ) {
      this._recAcc = 0
      this.record.push(this.snapshotFrame(sensed, a, rul))
      if (this.record.length > RECORD_MAX) this.record.shift()
    }
  }

  snapshotFrame(s, a, rul) {
    return {
      t: this.t,
      rpm: s.rpm, map: s.map, power: s.power, torque: s.torque,
      cht: s.cht.slice(), egt: s.egt.slice(),
      chtMean: this.actual.chtMean, egtMean: this.actual.egtMean,
      oilPress: s.oilPress, oilTemp: s.oilTemp, coolantTemp: s.coolantTemp,
      fuelFlow: s.fuelFlow, fuelPress: s.fuelPress, lambda: s.lambda,
      injDuration: s.injDuration, injTiming: s.injTiming, knock: s.knock,
      vibration: s.vibration, busVolts: s.busVolts, altCurrent: s.altCurrent,
      alt_m: this.command.alt_m, throttle: this.command.throttle, oat: this.amb.T_C,
      score: a.score, health: a.health.overall, rulH: rul.hours,
      fault: a.best?.id ?? null, faultLabel: a.best?.label ?? null, cyl: a.cylinder, leg: this.legName,
      subs: Object.fromEntries(a.health.subsystems.map(x => [x.id, Math.round(x.value)])),
    }
  }

  /** Raise an alert whenever a monitored parameter crosses a band boundary. */
  trackBands(s, a) {
    const check = (key, val, label) => {
      if (val == null || Number.isNaN(val)) return
      const b = bandOf(key, val)
      const prev = this.bands[label] ?? 'good'
      // Dwell filter: a parameter sitting exactly on a threshold would
      // otherwise flap the event log. The new band has to hold for 2 s before
      // it is committed — the same debounce a certified EICAS applies.
      const pend = (this._bandPend ||= {})
      if (b !== prev) {
        if (pend[label]?.band !== b) { pend[label] = { band: b, t: this.t }; return }
        if (this.t - pend[label].t < 2) return
        delete pend[label]
        this.bands[label] = b
        const P = PARAMS[key]
        if (b === 'warning' || b === 'critical') {
          // Report the threshold that was actually crossed. A parameter with
          // both a low and a high limit (oil pressure, bus voltage) must not
          // quote its ceiling when it has fallen through its floor.
          const hi = b === 'critical' ? P.alarmHi : P.warnHi
          const lo = b === 'critical' ? P.alarmLo : P.warnLo
          const crossedLow = lo != null && val <= lo
          const limit = crossedLow ? lo : hi
          this.pushAlert('limit', b === 'critical' ? 'critical' : 'warning',
            `${b === 'critical' ? 'LIMIT EXCEEDED' : 'CAUTION'} — ${label}`,
            `${val.toFixed(P.decimals)} ${P.unit} (${crossedLow ? 'minimum' : 'maximum'} ${limit} ${P.unit})`)
        } else if (prev !== 'good') {
          this.pushAlert('limit-clear', 'good', `RECOVERED — ${label}`, `${val.toFixed(P.decimals)} ${P.unit} back within normal band.`)
        }
      } else if (pend[label]) { delete pend[label] }
    }
    s.cht.forEach((v, i) => check('cht', v, `CHT CYL ${i + 1}`))
    s.egt.forEach((v, i) => check('egt', v, `EGT CYL ${i + 1}`))
    check('oilPress', s.oilPress, 'OIL PRESSURE')
    check('oilTemp', s.oilTemp, 'OIL TEMP')
    check('coolantTemp', s.coolantTemp, 'COOLANT TEMP')
    check('vibration', s.vibration, 'VIBRATION')
    check('busVolts', s.busVolts, 'BUS VOLTAGE')
    check('knock', s.knock, 'KNOCK INDEX')
    check('rpm', s.rpm, 'ENGINE RPM')
    check('fuelPress', s.fuelPress, 'FUEL PRESSURE')

    /* Diagnosis lifecycle events. */
    const id = a.best?.id ?? null
    if (id !== this._lastDiag) {
      if (id && a.score > 0.45) {
        const cyl = a.cylinder != null ? ` — CYL ${a.cylinder + 1}` : ''
        this.pushAlert('diagnosis', a.score > 0.7 ? 'critical' : 'warning',
          `DIAGNOSIS — ${a.best.label}${cyl}`,
          `Confidence ${(a.best.confidence * 100).toFixed(0)}%. Top evidence: ${a.evidence.slice(0, 2).map(e => `${e.label} ${e.z > 0 ? '+' : '−'}${Math.abs(e.z).toFixed(1)}σ`).join(', ')}.`)
      } else if (!id && this._lastDiag) {
        this.pushAlert('diagnosis-clear', 'good', 'ANOMALY CLEARED', 'Residuals have returned inside the model noise band.')
      }
      this._lastDiag = id
    }
  }
}
