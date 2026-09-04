/**
 * AI / ML ANALYTICS LAYER
 *
 * Runs every telemetry tick and produces the four outputs the Digital Twin is
 * required to deliver:
 *   1. anomaly detection      - is the engine off-nominal, and how confident
 *   2. fault isolation        - which fault, which cylinder, why  (explainable)
 *   3. health indices         - per subsystem and overall
 *   4. prognostics            - time-to-limit (minutes) and RUL (hours)
 *
 * The detector is model-based: residual = sensed - physics-model-prediction,
 * normalised by the measured healthy noise floor. That is what makes it a
 * physics-informed detector rather than a threshold alarm - it is sensitive to
 * a 3-sigma drift that is still nowhere near any red line, and it does not
 * false-alarm when the pilot simply changes throttle or altitude, because the
 * reference model changes with the command too.
 */

import { FEATURES, extract } from './features.js'
import { PARAMS, SUBSYSTEMS, bandOf } from '../sim/spec.js'
import { WEAR_CHANNELS } from '../sim/spec.js'

const D = FEATURES.length
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/** Which subsystem owns each monitored gauge, for the health roll-up. */
const PARAM_SUB = {
  cht: 'cooling', egt: 'combustion', coolantTemp: 'cooling',
  oilPress: 'lubrication', oilTemp: 'lubrication',
  fuelFlow: 'fuel', fuelPress: 'fuel', lambda: 'fuel', injDuration: 'fuel',
  injTiming: 'ignition', knock: 'combustion',
  vibration: 'mechanical', rpm: 'mechanical',
  busVolts: 'electrical', altCurrent: 'electrical', map: 'induction',
}

export class Analytics {
  constructor(dictionary) {
    this.dict = dictionary
    this.z = new Array(D).fill(0)        // EWMA-smoothed residual z-score
    this.zFast = new Array(D).fill(0)    // fast EWMA, for step detection
    this.cusum = new Array(D).fill(0)    // one-sided CUSUM, for slow drifts
    this.history = {}                    // param → [{t, v}] for trend fitting
    this.score = 0
    this.detected = false
    this.detectLatch = 0
    this.sensorSuspect = new Array(4).fill(0)
    this.t = 0
  }

  reset() {
    this.z.fill(0); this.zFast.fill(0); this.cusum.fill(0)
    this.history = {}; this.score = 0; this.detected = false; this.detectLatch = 0
  }

  /**
   * @param sensed  what the CAN bus reports (with sensor faults applied)
   * @param ref     the healthy reference twin's state for the same commands
   * @param wear    current wear vector
   * @param rul     output of estimateRUL()
   * @param rpmHist recent RPM samples for the roughness feature
   */
  update(sensed, ref, wear, rul, hist, dt) {
    this.t += dt
    const dict = this.dict
    const fs = extract(sensed, ref, hist)
    const fr = extract(ref, ref, hist)

    /* ── 1. Residual generation & normalisation ────────────────────────── */
    const zRaw = new Array(D)
    for (let d = 0; d < D; d++) zRaw[d] = (fs.v[d] - fr.v[d]) / dict.sigma[d]

    const aS = 1 - Math.exp(-dt / 3.0)     // slow EWMA (3 s) - stable direction
    const aF = 1 - Math.exp(-dt / 0.6)     // fast EWMA (0.6 s) - step response
    for (let d = 0; d < D; d++) {
      this.z[d] += (zRaw[d] - this.z[d]) * aS
      this.zFast[d] += (zRaw[d] - this.zFast[d]) * aF
      // CUSUM catches a slow drift long before it clears any threshold. It
      // charges slowly (that is the point) but must DRAIN fast, or a cleared
      // fault leaves a ghost detection behind for minutes.
      const excess = Math.abs(zRaw[d]) - 1.2
      this.cusum[d] = clamp(this.cusum[d] + excess * (excess > 0 ? 0.25 : 3.0) * dt, 0, 60)
    }

    /* ── 2. Anomaly statistic ──────────────────────────────────────────── */
    // Hotelling-style energy over the residual vector, robustified: only the
    // part of each residual beyond 2.5 sigma counts, so noise never accumulates
    // into a false positive across 24 channels.
    let energy = 0, cusumMax = 0
    for (let d = 0; d < D; d++) {
      const e = Math.max(0, Math.abs(this.z[d]) - 2.5)
      energy += e * e
      cusumMax = Math.max(cusumMax, this.cusum[d])
    }
    const driftScore = clamp((cusumMax - 8) / 32, 0, 1)
    const stepScore = 1 - Math.exp(-energy / 55)
    // Magnitude gate: the residual VECTOR has to be materially off the model
    // before anything is declared. Healthy cruise sits below 2; without this
    // gate the classifier will still name its best cosine match for pure noise,
    // which is how a detector earns a reputation for crying wolf.
    const norm0 = Math.hypot(...this.z)
    const magGate = clamp((norm0 - 3) / 3, 0, 1)
    this.score = clamp(Math.max(stepScore, driftScore * 0.85) * magGate, 0, 1)

    // Latch with hysteresis so the verdict does not flicker on the boundary.
    if (this.score > 0.35) this.detectLatch = Math.min(this.detectLatch + dt, 3)
    else this.detectLatch = Math.max(this.detectLatch - dt * 0.6, 0)
    this.detected = this.detectLatch > 0.6

    /* ── 3. Fault isolation by structured-residual matching ────────────── */
    const norm = norm0 || 1
    const unit = this.z.map(v => v / norm)
    const cands = dict.entries.map(e => {
      let cos = 0
      for (let d = 0; d < D; d++) cos += unit[d] * e.dir[d]
      // Severity: how far along this fault's own full-severity magnitude we are.
      const severity = clamp(norm / (e.magnitude * 0.55), 0, 1.6)
      // Plausibility constraint: no fault can produce a residual louder than its
      // own full-severity signature. This is what separates two faults that
      // point the same way in residual space but differ in how hard they hit -
      // e.g. an oil-pressure loss versus slow oil degradation.
      const sevPenalty = Math.max(0, severity - 1.15)
      return { ...e, cos, severity, match: cos - 0.12 * sevPenalty }
    }).sort((a, b) => b.match - a.match)

    // Soft confidence over the top candidates (temperature-scaled softmax on the
    // cosine margin). Nearly-degenerate physics - a misfire versus a fouled plug
    // - correctly reports as two live hypotheses rather than false certainty.
    const top = cands.slice(0, 4).filter(c => c.cos > 0.25)
    const T = 0.06
    const ex = top.map(c => Math.exp((c.match - (top[0]?.match ?? 0)) / T))
    const exSum = ex.reduce((a, b) => a + b, 0) || 1
    top.forEach((c, i) => { c.confidence = (ex[i] / exSum) * clamp(this.score * 1.15, 0, 1) })

    /* ── 4. Spatial localisation (which cylinder) ──────────────────────── */
    let best = top[0]
    let cylinder = null
    if (best?.perCylinder) {
      const dev = fs.cylDev.egtDev.map((e, i) => e * best.cylSign + fs.cylDev.chtDev[i] * best.cylSign * 2)
      let bi = 0
      for (let i = 1; i < dev.length; i++) if (dev[i] > dev[bi]) bi = i
      if (dev[bi] > 8) cylinder = bi
    }

    /* ── 5. Explainability: top feature contributions ──────────────────── */
    const contrib = FEATURES.map((f, d) => ({
      key: f.key, label: f.label, sub: f.sub,
      z: this.z[d],
      // Share of the matched fault direction actually explained by this channel.
      weight: best ? Math.abs(unit[d] * best.dir[d]) : Math.abs(unit[d]),
      residual: (fs.v[d] - fr.v[d]),
      observed: fs.v[d], expected: fr.v[d],
    }))
    const wSum = contrib.reduce((a, c) => a + c.weight, 0) || 1
    contrib.forEach(c => { c.share = c.weight / wSum })
    const evidence = [...contrib].sort((a, b) => b.share - a.share).slice(0, 6)

    /* ── 6. Sensor-integrity cross-check ───────────────────────────────── */
    // A channel that moves with NO corroborating physical channel is a sensor
    // problem, not an engine problem. This is the false-alarm suppressor.
    const iz = k => this.z[FEATURES.findIndex(f => f.key === k)]
    const corroborated = Math.hypot(iz('oilTemp'), iz('vibration'), iz('vibMid'))
    const sensorDoubt = clamp((Math.abs(iz('oilPress')) - 3) / 6, 0, 1) * (1 - clamp(corroborated / 6, 0, 1))
    const invalid = sensed.sensorValid
      ? sensed.sensorValid.cht.map((v, i) => !v || !sensed.sensorValid.egt[i])
      : new Array(fs.n).fill(false)
    // A dropped channel produces NO residual by construction - the twin has
    // already substituted its model estimate for it. Validity is therefore a
    // discrete diagnostic, detected by the health monitor rather than by the
    // statistical detector, and it must not be allowed to pass silently.
    const invalidCyl = invalid.findIndex(Boolean)
    if (invalidCyl >= 0) {
      const entry = dict.entries.find(e => e.id === 'sensor_dropout')
      if (entry) {
        const forced = { ...entry, cos: 1, severity: 1, match: 1, confidence: 0.99 }
        const kept = top.filter(c => c.id !== 'sensor_dropout')
                        .map(c => ({ ...c, confidence: (c.confidence ?? 0) * 0.25 }))
        top.length = 0
        top.push(forced, ...kept.slice(0, 3))
      }
      this.detected = true
      this.score = Math.max(this.score, 0.75)
    }

    if (invalidCyl >= 0) { best = top[0]; cylinder = invalidCyl }

    /* ── 7. Health indices ─────────────────────────────────────────────── */
    const health = this.computeHealth(sensed, wear, contrib)

    /* ── 8. Trend fitting → time-to-limit ──────────────────────────────── */
    const trends = this.updateTrends(sensed, dt)

    return {
      z: this.z.slice(), zRaw, cusum: this.cusum.slice(),
      score: this.score, detected: this.detected,
      magnitude: norm,
      candidates: top, best: this.detected ? best : null, cylinder,
      evidence, health, trends,
      sensorDoubt, invalidChannels: invalid,
      rul,
      features: fs.named, expected: fr.named,
    }
  }

  computeHealth(s, wear, contrib) {
    const subs = {}
    for (const sub of SUBSYSTEMS) subs[sub.id] = { id: sub.id, label: sub.label, short: sub.short, value: 100, drivers: [] }

    // (a) accumulated wear on the channels this subsystem owns
    for (const [ch, meta] of Object.entries(WEAR_CHANNELS)) {
      const t = subs[meta.subsystem]
      if (!t) continue
      const pen = 55 * (wear[ch] || 0)
      t.value -= pen
      if (pen > 1) t.drivers.push({ label: `${meta.label} wear`, pen })
    }
    // (b) live residual evidence
    for (const c of contrib) {
      const t = subs[c.sub]
      if (!t) continue
      const pen = Math.min(38, 5.5 * Math.max(0, Math.abs(c.z) - 3))
      t.value -= pen
      if (pen > 1) t.drivers.push({ label: `${c.label} residual ${c.z > 0 ? '+' : '−'}${Math.abs(c.z).toFixed(1)}σ`, pen })
    }
    // (c) proximity to certified operating limits
    const check = (key, val) => {
      const p = PARAMS[key], t = subs[PARAM_SUB[key]]
      if (!p || !t || val == null) return
      let prox = 0
      if (p.warnHi != null && p.alarmHi != null) prox = Math.max(prox, (val - p.warnHi) / (p.alarmHi - p.warnHi))
      if (p.warnLo != null && p.alarmLo != null) prox = Math.max(prox, (p.warnLo - val) / (p.warnLo - p.alarmLo))
      const pen = clamp(prox, 0, 1.4) * 42
      t.value -= pen
      if (pen > 1) t.drivers.push({ label: `${p.label} at limit`, pen })
    }
    const mean = a => a.reduce((x, y) => x + (y || 0), 0) / a.length
    check('cht', Math.max(...s.cht.filter(v => v != null), 0))
    check('egt', Math.max(...s.egt.filter(v => v != null), 0))
    check('oilPress', s.oilPress); check('oilTemp', s.oilTemp)
    check('coolantTemp', s.coolantTemp); check('vibration', s.vibration)
    check('busVolts', s.busVolts); check('knock', s.knock)
    check('lambda', s.lambda); check('fuelPress', s.fuelPress)

    const list = Object.values(subs)
    for (const t of list) {
      t.value = clamp(t.value, 0, 100)
      t.drivers.sort((a, b) => b.pen - a.pen)
      t.drivers = t.drivers.slice(0, 3)
      t.band = t.value >= 85 ? 'good' : t.value >= 65 ? 'warning' : t.value >= 40 ? 'serious' : 'critical'
    }
    const vals = list.map(t => t.value)
    const worst = Math.min(...vals)
    // Weighted toward the worst subsystem: one dying subsystem is not averaged
    // away by eight healthy ones.
    const overall = clamp(0.6 * worst + 0.4 * mean(vals), 0, 100)
    return {
      overall, worst, subsystems: list,
      band: overall >= 85 ? 'good' : overall >= 65 ? 'warning' : overall >= 40 ? 'serious' : 'critical',
    }
  }

  /** Least-squares slope over a 90 s window → projected time to each limit.
   *  History is decimated to 4 Hz: a slope fitted to 1800 samples of the same
   *  90 seconds is no better than one fitted to 360, and costs 5× the work. */
  updateTrends(s, dt) {
    const WINDOW = 90
    this._trendAcc = (this._trendAcc || 0) + dt
    if (this._trendAcc < 0.25) return this._trends || []
    this._trendAcc = 0
    const track = {
      cht: Math.max(...s.cht.filter(v => v != null), 0),
      egt: Math.max(...s.egt.filter(v => v != null), 0),
      oilPress: s.oilPress, oilTemp: s.oilTemp, coolantTemp: s.coolantTemp,
      vibration: s.vibration, busVolts: s.busVolts, knock: s.knock, fuelPress: s.fuelPress,
    }
    const out = []
    for (const [k, v] of Object.entries(track)) {
      if (v == null || Number.isNaN(v)) continue
      const h = (this.history[k] ||= [])
      h.push({ t: this.t, v })
      while (h.length && this.t - h[0].t > WINDOW) h.shift()
      // Need a real window before projecting: a slope off five seconds of a
      // throttle transient is not a trend.
      if (h.length < 48 || this.t - h[0].t < 20) {
        out.push({ key: k, label: PARAMS[k]?.label ?? k, value: v, slope: 0, slopePerMin: 0, ttl: null, band: bandOf(k, v) })
        continue
      }
      const n = h.length
      const mt = h.reduce((a, p) => a + p.t, 0) / n
      const mv = h.reduce((a, p) => a + p.v, 0) / n
      let num = 0, den = 0
      for (const p of h) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2 }
      const slope = den > 0 ? num / den : 0      // units per second
      const P = PARAMS[k]
      let ttl = null, target = null
      if (P) {
        if (slope > 1e-6 && P.alarmHi != null && v < P.alarmHi) { ttl = (P.alarmHi - v) / slope; target = P.alarmHi }
        if (slope < -1e-6 && P.alarmLo != null && v > P.alarmLo) { ttl = (P.alarmLo - v) / slope; target = P.alarmLo }
      }
      out.push({ key: k, label: P?.label ?? k, value: v, slope, slopePerMin: slope * 60, ttl, target, band: bandOf(k, v) })
    }
    out.sort((a, b) => (a.ttl ?? Infinity) - (b.ttl ?? Infinity))
    this._trends = out
    return out
  }
}
