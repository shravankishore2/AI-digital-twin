/**
 * FAULT SIGNATURE DICTIONARY  (physics-informed, self-generated)
 *
 * Rather than hand-labelling what each fault "looks like", the twin generates
 * its own dictionary: for every fault in the library it runs the physics model
 * to steady state at a set of representative operating points, differences the
 * result against the healthy reference run, and normalises by the healthy-run
 * residual noise. The result is a unit direction vector in residual space per
 * fault - a structured-residual fault dictionary, the classical model-based FDI
 * formulation, but built automatically from the plant model.
 *
 * Classification at run time is then a cosine match between the live residual
 * direction and the dictionary. This is what makes the diagnosis explainable:
 * every decision decomposes into named, physically meaningful feature
 * contributions that can be shown to a propulsion engineer.
 */

import { atmosphere, createEngineState, stepEngine, sense } from '../sim/engineModel.js'
import { buildModifiers, FAULTS } from '../sim/faults.js'
import { extract, FEATURES } from './features.js'

/** Operating points the dictionary is trained over (alt m, throttle, ISA dev). */
const TRAIN_POINTS = [
  { alt: 3000, thr: 0.72, isa: 0,  ias: 58 },   // nominal cruise
  { alt: 5500, thr: 0.85, isa: 0,  ias: 55 },   // high-altitude transit
  { alt: 1500, thr: 0.55, isa: 20, ias: 45 },   // hot-and-low loiter
]

const SETTLE_S = 180
const SAMPLE_S = 25
const DT = 0.05

function runPoint(faults, pt, collect = false) {
  const amb = atmosphere(pt.alt, pt.isa)
  const s = createEngineState(amb)
  const mods = buildModifiers(faults)
  const ctx = { throttle: pt.thr, alt_m: pt.alt, isaDev_C: pt.isa, airspeed_ms: pt.ias, mods, wear: {}, amb }
  const hist = { rpm: [], egtDev: [] }
  const push = (st) => {
    hist.rpm.push(st.rpm)
    const mu = st.egt.reduce((a, b) => a + b, 0) / st.egt.length
    hist.egtDev.push(st.egt.map(v => v - mu))
    if (hist.rpm.length > 40) { hist.rpm.shift(); hist.egtDev.shift() }
  }
  for (let i = 0; i < SETTLE_S / DT; i++) { stepEngine(s, DT, ctx); push(sense(s, mods)) }
  if (!collect) {
    const f = extract(sense(s, mods), s, hist)
    return { v: f.v, cylDev: f.cylDev, state: s }
  }
  // Collect a window of samples so we can measure residual noise, not just mean.
  const samples = []
  for (let i = 0; i < SAMPLE_S / DT; i++) {
    stepEngine(s, DT, ctx); push(sense(s, mods))
    if (i % 4 === 0) samples.push(extract(sense(s, mods), s, hist).v)
  }
  return { samples, state: s }
}

const zeros = () => FEATURES.map(() => 0)

/**
 * Build the dictionary. Runs ~70 short simulations; call it off the critical
 * render path (the store does this once at boot and reports progress).
 */
export function buildDictionary(onProgress) {
  const D = FEATURES.length
  const baselineByPoint = []
  const sigma = zeros()

  // 1. Healthy baselines + residual noise floor, per operating point.
  TRAIN_POINTS.forEach((pt, pi) => {
    const { samples } = runPoint([], pt, true)
    const mu = zeros()
    for (const s of samples) for (let d = 0; d < D; d++) mu[d] += s[d] / samples.length
    for (let d = 0; d < D; d++) {
      let acc = 0
      for (const s of samples) acc += (s[d] - mu[d]) ** 2
      sigma[d] = Math.max(sigma[d], Math.sqrt(acc / samples.length))
    }
    baselineByPoint[pi] = mu
    onProgress?.((pi + 1) / (TRAIN_POINTS.length + FAULTS.length), 'baseline')
  })

  // A floor on sigma keeps a quiet channel from producing infinite z-scores.
  const FLOOR = { rpm: 12, map: 0.15, power: 0.4, chtMean: 0.9,
    chtDevHi: 0.7, chtDevLo: 0.7, egtMean: 5, egtDevHi: 5, egtDevLo: 5,
    oilPress: 0.04, oilTemp: 0.5, coolantTemp: 0.5,
    fuelFlow: 0.2, fuelPress: 0.03, lambda: 0.006, injDuration: 0.06,
    injTiming: 0.15, knock: 0.01, vibration: 0.04, vibLow: 0.02, vibMid: 0.02,
    vibHigh: 0.02, busVolts: 0.03, altCurrent: 0.3, rpmRough: 2.5, turboRPM: 1.2,
    egtRoughHi: 1.5, egtRoughMean: 1.2 }
  FEATURES.forEach((f, d) => { sigma[d] = Math.max(sigma[d], FLOOR[f.key] ?? 0.05) })

  // 2. One normalised residual direction per fault, averaged over the points.
  const entries = []
  FAULTS.forEach((flt, fi) => {
    const acc = zeros()
    let cylSign = 0
    TRAIN_POINTS.forEach((pt, pi) => {
      const { v, cylDev } = runPoint([{ id: flt.id, cyl: 1, intensity: 1 }], pt)
      for (let d = 0; d < D; d++) acc[d] += (v[d] - baselineByPoint[pi][d]) / sigma[d]
      if (flt.perCylinder) cylSign += cylDev.egtDev[1]
    })
    for (let d = 0; d < D; d++) acc[d] /= TRAIN_POINTS.length
    const norm = Math.hypot(...acc) || 1
    entries.push({
      id: flt.id, label: flt.label, abbr: flt.abbr, cat: flt.cat, part: flt.part,
      perCylinder: !!flt.perCylinder, signature: flt.signature, desc: flt.desc,
      dir: acc.map(x => x / norm),      // unit direction in z-space
      magnitude: norm,                   // how loud this fault is at full severity
      cylSign: Math.sign(cylSign) || 1,  // does the bad cylinder read hot or cold?
    })
    onProgress?.((TRAIN_POINTS.length + fi + 1) / (TRAIN_POINTS.length + FAULTS.length), flt.label)
  })

  return { sigma, entries, features: FEATURES.map(f => f.key), builtAt: Date.now(), points: TRAIN_POINTS.length }
}
