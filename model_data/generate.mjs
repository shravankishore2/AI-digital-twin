/**
 * DATASET GENERATOR — AeroTwin fault/degradation corpus
 * ====================================================
 *
 * Sweeps the physics engine model across the full operating envelope, injects
 * every fault in the library across its full severity ramp, and writes a
 * labelled, split, ML-ready corpus.
 *
 *   node model_data/generate.mjs            # full run
 *   node model_data/generate.mjs --smoke    # tiny run, for checking the shape
 *
 * DESIGN
 * ------
 * Operating envelope   5 altitudes × 4 throttle settings × 3 ISA deviations = 60 points
 * Fleet age            3 wear levels (fresh / mid-life / late-life)
 * Fault configurations 16 engine-wide faults + 7 per-cylinder faults × 4 cylinders = 44
 * Severity             sampled continuously DOWN the fault's own ramp, not only at
 *                      full severity — so the corpus contains the incipient stage,
 *                      which is the stage that actually matters for prediction
 * Healthy class        sampled at every operating point and every wear level
 *
 * Every fault run starts from a settled healthy engine at that exact operating
 * point and wear level, so the only difference between a healthy row and a
 * faulted row is the fault itself.
 *
 * SPLIT POLICY
 * ------------
 * train/val/test are split by OPERATING POINT, not by row. Test rows therefore
 * come from altitude/throttle/temperature combinations the training set never
 * contains — so a model scored on it is being asked to generalise across the
 * envelope, not to interpolate between neighbouring samples of the same run.
 * Every fault class appears in all three splits (you need that to train a
 * classifier at all); the CONDITIONS are what is held out.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ── deterministic RNG (the model calls Math.random internally) ─────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SEED = 20260904
const rng = mulberry32(SEED)
Math.random = rng                       // makes the whole corpus reproducible

const { atmosphere, createEngineState, stepEngine, sense } = await import('../src/sim/engineModel.js')
const { buildModifiers, FAULTS, FAULT_BY_ID } = await import('../src/sim/faults.js')
const { createWear, stepWear, estimateRUL } = await import('../src/sim/wear.js')
const { extract, FEATURES } = await import('../src/ml/features.js')
const { buildDictionary } = await import('../src/ml/dictionary.js')
const { WEAR_CHANNELS, PARAMS, TBO_HOURS, ENGINE } = await import('../src/sim/spec.js')

const OUT = path.dirname(fileURLToPath(import.meta.url))
const SMOKE = process.argv.includes('--smoke')

/* ── experiment design ─────────────────────────────────────────────────── */
const ALTS      = SMOKE ? [0, 3600]        : [0, 1800, 3600, 5400, 7200]      // m
const THROTTLES = SMOKE ? [0.5, 0.95]      : [0.30, 0.50, 0.72, 0.95]
const ISA_DEVS  = SMOKE ? [0]              : [-10, 0, 28]                      // °C
const WEAR_LVLS = SMOKE ? [0, 0.30]        : [0.0, 0.15, 0.32]                 // fraction of life used
const RAMP_SAMPLES = [0.04, 0.10, 0.18, 0.28, 0.40, 0.52, 0.64, 0.76, 0.88, 1.00]
const HOLD_SAMPLES = SMOKE ? 1 : 2         // extra samples after the ramp completes
const HEALTHY_PER_CELL = SMOKE ? 8 : 150
const HEALTHY_GAP_S = 3
const SETTLE_S = 170
const DT = 0.05

/* Airspeed follows power setting (a UAV at high power is flying faster), with a
   deterministic offset per operating point so cooling flow is not a pure
   function of throttle. */
const iasFor = (thr, k) => 24 + 42 * thr + ((k % 5) - 2) * 3

/* A fixed per-channel wear profile: components do not age uniformly. */
const WEAR_KEYS = Object.keys(WEAR_CHANNELS)
const WEAR_PROFILE = Object.fromEntries(WEAR_KEYS.map((k, i) => [k, 0.55 + 0.9 * ((i * 7919) % 100) / 100]))

/* ── build the operating-point table ───────────────────────────────────── */
const OPS = []
let k = 0
for (const alt of ALTS) for (const thr of THROTTLES) for (const isa of ISA_DEVS) {
  OPS.push({ op_id: OPS.length, alt_m: alt, throttle: thr, isa_dev_C: isa, airspeed_ms: iasFor(thr, k++) })
}
// Seeded shuffle → 70/15/15 split over operating points (whole conditions held out)
const order = OPS.map((_, i) => i)
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[order[i], order[j]] = [order[j], order[i]] }
const nTest = Math.max(1, Math.round(OPS.length * 0.15))
const nVal = Math.max(1, Math.round(OPS.length * 0.15))
order.forEach((opIdx, rank) => {
  OPS[opIdx].split = rank < nTest ? 'test' : rank < nTest + nVal ? 'val' : 'train'
})

/* ── fault configuration list ──────────────────────────────────────────── */
const CONFIGS = []
for (const f of FAULTS) {
  if (f.perCylinder) for (let c = 0; c < ENGINE.cylinders; c++) CONFIGS.push({ id: f.id, cyl: c, def: f })
  else CONFIGS.push({ id: f.id, cyl: -1, def: f })
}
const LABELS = ['healthy', ...FAULTS.map(f => f.id)]
const LABEL_IDX = Object.fromEntries(LABELS.map((l, i) => [l, i]))

/* ── noise floor: reuse the twin's own sigma so z-scores match the app ──── */
process.stdout.write('building residual noise floor (sigma)… ')
const DICT = buildDictionary()
console.log('done')
const SIGMA = DICT.sigma

/* ── column schema ─────────────────────────────────────────────────────── */
const SENSED_SCALARS = ['rpm', 'propRPM', 'map', 'boost', 'oilPress', 'oilTemp', 'coolantTemp',
  'fuelFlow', 'fuelPress', 'lambda', 'injDuration', 'injTiming', 'knock', 'vibration',
  'busVolts', 'altCurrent', 'turboRPM', 'power', 'torque']

const COLUMNS = [
  'sample_id', 'run_id', 'op_id', 'split',
  'alt_m', 'isa_dev_C', 'oat_C', 'airspeed_ms', 'throttle',
  'label', 'label_idx', 'anomaly', 'cylinder', 'severity', 'fault_category',
  ...SENSED_SCALARS.map(c => `s_${c}`),
  ...[1, 2, 3, 4].map(i => `s_cht${i}`), ...[1, 2, 3, 4].map(i => `s_egt${i}`),
  ...Array.from({ length: 12 }, (_, i) => `s_vib_b${i + 1}`),
  ...[1, 2, 3, 4].map(i => `s_cht${i}_valid`), ...[1, 2, 3, 4].map(i => `s_egt${i}_valid`),
  ...FEATURES.map(f => `f_${f.key}`),
  ...FEATURES.map(f => `z_${f.key}`),
  ...WEAR_KEYS.map(w => `w_${w}`),
  'wear_level', 'rul_hours', 'rul_limiting', 'life_used_pct',
]

/* ── helpers ───────────────────────────────────────────────────────────── */
const num = v => (v == null || Number.isNaN(v)) ? '' : String(+(+v).toPrecision(6))
const clone = s => ({ ...s, cht: [...s.cht], egt: [...s.egt], compression: [...s.compression],
  cylBurn: [...s.cylBurn], vibSpectrum: [...s.vibSpectrum] })
const cloneHist = h => ({ rpm: [...h.rpm], egtDev: h.egtDev.map(r => [...r]) })
const pushHist = (h, sd, ref) => {
  h.rpm.push(sd.rpm)
  const e = sd.egt.map((v, i) => (v == null ? ref.egt[i] : v))
  const mu = e.reduce((a, b) => a + b, 0) / e.length
  h.egtDev.push(e.map(v => v - mu))
  if (h.rpm.length > 40) { h.rpm.shift(); h.egtDev.shift() }
}

/* ── output streams ────────────────────────────────────────────────────── */
const streams = {}
for (const sp of ['train', 'val', 'test']) {
  streams[sp] = fs.createWriteStream(path.join(OUT, `${sp}.csv`))
  streams[sp].write(COLUMNS.join(',') + '\n')
}
let sampleId = 0, runId = 0
const counts = { train: 0, val: 0, test: 0 }
const byLabel = {}

function writeRow(op, run, oat, sd, feats, z, wear, rul, label, cyl, severity, wearLevel) {
  const row = [
    sampleId++, run, op.op_id, op.split,
    num(op.alt_m), num(op.isa_dev_C), num(oat), num(op.airspeed_ms), num(op.throttle),
    label, LABEL_IDX[label], label === 'healthy' ? 0 : 1, cyl, num(severity),
    label === 'healthy' ? 'none' : FAULT_BY_ID[label].cat,
    ...SENSED_SCALARS.map(c => num(sd[c])),
    ...sd.cht.map(num), ...sd.egt.map(num),
    ...sd.vibSpectrum.map(num),
    ...(sd.sensorValid ? sd.sensorValid.cht.map(v => v ? 1 : 0) : [1, 1, 1, 1]),
    ...(sd.sensorValid ? sd.sensorValid.egt.map(v => v ? 1 : 0) : [1, 1, 1, 1]),
    ...feats.map(num),
    ...z.map(num),
    ...WEAR_KEYS.map(w => num(wear[w])),
    num(wearLevel), num(rul.hours), rul.limiting.id, num(rul.limiting.lifeUsedPct),
  ]
  streams[op.split].write(row.join(',') + '\n')
  counts[op.split]++
  byLabel[label] = (byLabel[label] || 0) + 1
}

/* ── main sweep ────────────────────────────────────────────────────────── */
const t0 = Date.now()
const totalCells = OPS.length * WEAR_LVLS.length
let cell = 0

for (const op of OPS) {
  const amb = atmosphere(op.alt_m, op.isa_dev_C)
  const ctxBase = { throttle: op.throttle, alt_m: op.alt_m, isaDev_C: op.isa_dev_C, airspeed_ms: op.airspeed_ms, amb }
  const blank = buildModifiers([])

  for (const lvl of WEAR_LVLS) {
    cell++
    const wear0 = createWear(Object.fromEntries(WEAR_KEYS.map(w => [w, lvl * WEAR_PROFILE[w]])))

    // Healthy engine at this operating point AND this wear level — settled once.
    // This settled state is BOTH the starting point for every fault run and the
    // reference the residual is taken against. The reference therefore carries
    // the same accumulated wear as the engine under test, so a residual
    // measures the FAULT and not the engine's age. Age is carried separately in
    // the w_* columns; conflating the two makes an aged healthy engine
    // indistinguishable from an incipient fault.
    const healthySeed = createEngineState(amb)
    const healthyHist = { rpm: [], egtDev: [] }
    const wSettle = createWear(wear0)
    for (let i = 0; i < SETTLE_S / DT; i++) {
      stepEngine(healthySeed, DT, { ...ctxBase, mods: blank, wear: wSettle })
      stepWear(wSettle, DT, healthySeed, [], 1)
      pushHist(healthyHist, healthySeed, healthySeed)
    }
    const oat = amb.T_C

    // ── healthy class ────────────────────────────────────────────────────
    {
      const A = clone(healthySeed), B = clone(healthySeed)
      const hA = cloneHist(healthyHist), hB = cloneHist(healthyHist)
      const w = createWear(wSettle), wRef = createWear(wSettle)
      const rid = runId++
      for (let n = 0; n < HEALTHY_PER_CELL; n++) {
        for (let i = 0; i < HEALTHY_GAP_S / DT; i++) {
          stepEngine(A, DT, { ...ctxBase, mods: blank, wear: w })
          stepEngine(B, DT, { ...ctxBase, mods: blank, wear: wRef })
          stepWear(w, DT, A, [], 1)
          const sd = sense(A, blank)
          pushHist(hA, sd, B); pushHist(hB, B, B)
        }
        const sd = sense(A, blank)
        const fa = extract(sd, B, hA), fb = extract(B, B, hB)
        const z = fa.v.map((v, d) => (v - fb.v[d]) / SIGMA[d])
        writeRow(op, rid, oat, sd, fa.v, z, w, estimateRUL(w), 'healthy', -1, 0, lvl)
      }
    }

    // ── every fault, down its own severity ramp ──────────────────────────
    for (const cfg of CONFIGS) {
      const A = clone(healthySeed), B = clone(healthySeed)
      const hA = cloneHist(healthyHist), hB = cloneHist(healthyHist)
      const w = createWear(wSettle), wRef = createWear(wSettle)
      const rid = runId++
      const rampS = cfg.def.ramp_s
      const cyl = cfg.cyl < 0 ? 0 : cfg.cyl
      let intensity = 0

      const advanceTo = (target, extraS = 0) => {
        while (intensity < target - 1e-9) {
          intensity = Math.min(target, intensity + DT / rampS)
          const active = [{ id: cfg.id, cyl, intensity }]
          const mods = buildModifiers(active)
          stepEngine(A, DT, { ...ctxBase, mods, wear: w })
          stepEngine(B, DT, { ...ctxBase, mods: blank, wear: wRef })
          stepWear(w, DT, A, active, 1)
          const sd = sense(A, mods)
          pushHist(hA, sd, B); pushHist(hB, B, B)
        }
        for (let i = 0; i < extraS / DT; i++) {
          const active = [{ id: cfg.id, cyl, intensity }]
          const mods = buildModifiers(active)
          stepEngine(A, DT, { ...ctxBase, mods, wear: w })
          stepEngine(B, DT, { ...ctxBase, mods: blank, wear: wRef })
          stepWear(w, DT, A, active, 1)
          const sd = sense(A, mods)
          pushHist(hA, sd, B); pushHist(hB, B, B)
        }
      }
      const emit = () => {
        const mods = buildModifiers([{ id: cfg.id, cyl, intensity }])
        const sd = sense(A, mods)
        const fa = extract(sd, B, hA), fb = extract(B, B, hB)
        const z = fa.v.map((v, d) => (v - fb.v[d]) / SIGMA[d])
        writeRow(op, rid, oat, sd, fa.v, z, w, estimateRUL(w), cfg.id, cfg.cyl, intensity, lvl)
      }

      for (const target of RAMP_SAMPLES) { advanceTo(target); emit() }
      for (let hh = 0; hh < HOLD_SAMPLES; hh++) { advanceTo(1, 20); emit() }
    }

    if (cell % 10 === 0 || cell === totalCells) {
      const pct = ((cell / totalCells) * 100).toFixed(0)
      const el = ((Date.now() - t0) / 1000).toFixed(0)
      process.stdout.write(`\r  cell ${cell}/${totalCells} (${pct}%)  rows ${sampleId.toLocaleString()}  ${el}s   `)
    }
  }
}
console.log('')
for (const s of Object.values(streams)) s.end()

/* ── metadata ──────────────────────────────────────────────────────────── */
const groups = {
  identity: ['sample_id', 'run_id', 'op_id', 'split'],
  condition: ['alt_m', 'isa_dev_C', 'oat_C', 'airspeed_ms', 'throttle'],
  label: ['label', 'label_idx', 'anomaly', 'cylinder', 'severity', 'fault_category'],
  sensed: COLUMNS.filter(c => c.startsWith('s_')),
  feature: COLUMNS.filter(c => c.startsWith('f_')),
  residual: COLUMNS.filter(c => c.startsWith('z_')),
  wear: COLUMNS.filter(c => c.startsWith('w_')),
  target: ['rul_hours', 'rul_limiting', 'life_used_pct', 'wear_level'],
}
const describe = {
  sample_id: 'Unique row id', run_id: 'Id of the continuous simulation run this row came from',
  op_id: 'Operating point id — join to operating_points.csv', split: 'train | val | test (assigned by operating point)',
  alt_m: 'Pressure altitude, m', isa_dev_C: 'Deviation from ISA temperature, °C',
  oat_C: 'Outside air temperature, °C', airspeed_ms: 'True airspeed, m/s (drives cooling flow)',
  throttle: 'Throttle command, 0–1',
  label: 'Fault id, or "healthy"', label_idx: '0 = healthy, 1..23 = fault (see label_map.json)',
  anomaly: '1 if any fault is present at any severity, else 0',
  cylinder: '0-indexed affected cylinder, or -1 for engine-wide faults and healthy',
  severity: 'Fault intensity 0–1 at the moment of sampling (0 for healthy)',
  fault_category: 'Subsystem grouping of the fault, or "none"',
  wear_level: 'Fraction of component life consumed at the start of the run',
  rul_hours: 'Remaining useful life of the limiting component, engine-hours',
  rul_limiting: 'Which wear channel is limiting',
  life_used_pct: 'Percent of life consumed on the limiting channel',
}
for (const c of groups.sensed) describe[c] = 'Sensed channel as reported on the CAN bus (sensor noise, bias and dropout applied)'
for (const f of FEATURES) describe[`f_${f.key}`] = `Feature: ${f.label}`
for (const f of FEATURES) describe[`z_${f.key}`] = `Residual z-score: (observed − healthy-model prediction) / sigma, for ${f.label}`
for (const w of WEAR_KEYS) describe[`w_${w}`] = `Accumulated damage 0–1: ${WEAR_CHANNELS[w].label}`

fs.writeFileSync(path.join(OUT, 'schema.json'), JSON.stringify({
  generated: new Date().toISOString(), seed: SEED, rows: sampleId, columns: COLUMNS.length,
  column_order: COLUMNS, groups, descriptions: describe,
  reconstruct_reference: 'healthy-model prediction r_x = f_x − z_x * sigma[x]  (sigma in sigma.json)',
}, null, 2))

fs.writeFileSync(path.join(OUT, 'sigma.json'), JSON.stringify(
  Object.fromEntries(FEATURES.map((f, i) => [f.key, +SIGMA[i].toPrecision(6)])), null, 2))

fs.writeFileSync(path.join(OUT, 'label_map.json'), JSON.stringify({
  labels: LABELS.map((l, i) => l === 'healthy'
    ? { idx: i, id: 'healthy', label: 'Healthy', category: 'none', per_cylinder: false }
    : { idx: i, id: l, label: FAULT_BY_ID[l].label, category: FAULT_BY_ID[l].cat,
        per_cylinder: !!FAULT_BY_ID[l].perCylinder, ramp_s: FAULT_BY_ID[l].ramp_s,
        description: FAULT_BY_ID[l].desc, signature: FAULT_BY_ID[l].signature }),
}, null, 2))

fs.writeFileSync(path.join(OUT, 'operating_points.csv'),
  'op_id,split,alt_m,throttle,isa_dev_C,airspeed_ms\n' +
  OPS.map(o => [o.op_id, o.split, o.alt_m, o.throttle, o.isa_dev_C, o.airspeed_ms].join(',')).join('\n') + '\n')

fs.writeFileSync(path.join(OUT, 'limits.json'), JSON.stringify(PARAMS, null, 2))

const stats = {
  rows_total: sampleId, rows_by_split: counts,
  rows_by_label: Object.fromEntries(Object.entries(byLabel).sort((a, b) => b[1] - a[1])),
  healthy_fraction: +(byLabel.healthy / sampleId).toFixed(4),
  operating_points: OPS.length, wear_levels: WEAR_LVLS, fault_configs: CONFIGS.length,
  runs: runId, seconds: +((Date.now() - t0) / 1000).toFixed(1),
}
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2))

console.log(`\n${sampleId.toLocaleString()} rows · ${COLUMNS.length} columns · ${runId.toLocaleString()} runs · ${stats.seconds}s`)
console.log(`train ${counts.train.toLocaleString()} · val ${counts.val.toLocaleString()} · test ${counts.test.toLocaleString()}`)
console.log(`healthy ${byLabel.healthy?.toLocaleString()} (${(100 * stats.healthy_fraction).toFixed(1)}%)`)
