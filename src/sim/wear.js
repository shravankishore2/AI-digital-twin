/**
 * DEGRADATION / WEAR ACCUMULATOR
 *
 * Cumulative damage state, one scalar per wear channel (0 = new, 1 = life
 * expended). Wear is driven by *operating severity*, not by wall-clock time:
 * heat, knock, lean mixture, low oil pressure and vibration each accelerate the
 * channels they physically attack. Active faults multiply those rates.
 *
 * This is the state the RUL estimator extrapolates, and it is the only part of
 * the twin that persists across a mission.
 */

import { WEAR_CHANNELS, TBO_HOURS } from './spec.js'
import { FAULT_BY_ID } from './faults.js'

export function createWear(initial = {}) {
  const w = {}
  for (const k of Object.keys(WEAR_CHANNELS)) w[k] = initial[k] ?? 0
  return w
}

/** Severity multipliers derived from live engine state (1.0 = benign cruise). */
export function severityFactors(s) {
  const chtMean = s.chtMean ?? 100
  const heat = 1 + 2.6 * Math.max(0, (chtMean - 110) / 25) ** 1.6
  const oilHeat = 1 + 2.2 * Math.max(0, (s.oilTemp - 115) / 20) ** 1.5
  const knock = 1 + 5.5 * Math.max(0, (s.knock - 0.30) / 0.4)
  const lean = 1 + 3.0 * Math.max(0, (s.lambda - 1.05) / 0.15)
  const starve = 1 + 30.0 * Math.max(0, (2.2 - s.oilPress) / 2.0) ** 2
  const vib = 1 + 2.4 * Math.max(0, (s.vibration - 2.2) / 1.6)
  const load = 0.45 + 0.9 * Math.min((s.power || 0) / 55, 1.4)
  const volts = 1 + 2.0 * Math.max(0, (s.busVolts - 15.0) / 1.0)
  return { heat, oilHeat, knock, lean, starve, vib, load, volts }
}

/** Which severity factors attack which wear channel. */
const DRIVERS = {
  cylinder:   f => f.load * f.heat * f.knock * f.lean,
  valvetrain: f => f.load * f.heat * f.knock,
  injector:   f => f.load * f.lean,
  fuelPump:   f => f.load,
  ignition:   f => f.load * f.heat,
  bearing:    f => f.load * f.starve * f.vib * f.oilHeat,
  gearbox:    f => f.load * f.vib,
  oilSystem:  f => f.load * f.oilHeat * f.starve,
  coolingSys: f => f.load * f.heat,
  turbo:      f => f.load * f.heat,
  alternator: f => f.load * f.volts,
  sensorSet:  f => f.heat,
}

/**
 * Advance wear by dt seconds.
 * @param wear    mutable wear object
 * @param dt      seconds of engine running
 * @param s       engine state (truth)
 * @param active  [{ id, intensity }] currently injected faults
 * @param rate    global time-compression for the demo (1 = real time)
 */
export function stepWear(wear, dt, s, active = [], rate = 1) {
  const f = severityFactors(s)
  // Faults accelerate specific channels, weighted by their declared damage table.
  const accel = {}
  for (const a of active) {
    const def = FAULT_BY_ID[a.id]
    if (!def?.wear) continue
    for (const [ch, mult] of Object.entries(def.wear)) {
      accel[ch] = (accel[ch] || 0) + (mult / 10) * a.intensity
    }
  }
  for (const [ch, meta] of Object.entries(WEAR_CHANNELS)) {
    const drive = DRIVERS[ch] ? DRIVERS[ch](f) : f.load
    const r = meta.baseRate * drive * (1 + (accel[ch] || 0)) * rate
    wear[ch] = Math.min(1, wear[ch] + r * dt)
    wear[`${ch}_rate`] = r * 3600            // per-hour rate, for the RUL estimator
  }
  return wear
}

/**
 * Remaining Useful Life from the current wear vector and its instantaneous rate.
 * Returns per-channel hours plus the limiting channel.
 */
export function estimateRUL(wear) {
  const channels = []
  for (const [ch, meta] of Object.entries(WEAR_CHANNELS)) {
    const rate = Math.max(wear[`${ch}_rate`] ?? meta.baseRate * 3600, 1e-9)
    const remaining = Math.max(0, 1 - wear[ch])
    channels.push({
      id: ch, label: meta.label, subsystem: meta.subsystem,
      wear: wear[ch], ratePerHour: rate,
      hours: remaining / rate,
      lifeUsedPct: wear[ch] * 100,
    })
  }
  channels.sort((a, b) => a.hours - b.hours)
  const limiting = channels[0]
  return {
    hours: limiting.hours,
    limiting,
    channels,
    // Confidence falls when the current rate is far above the nominal rate the
    // baseline life was scheduled against - a short extrapolation off a
    // transient is a less trustworthy prediction than a long steady one.
    confidence: Math.max(0.25, Math.min(0.97,
      0.95 - 0.5 * Math.min(1, Math.log10(Math.max(limiting.ratePerHour / (1 / TBO_HOURS), 1)) / 2))),
  }
}

/** Fraction of TBO consumed, for the fleet/lifecycle card. */
export function lifeConsumed(wear) {
  const vals = Object.keys(WEAR_CHANNELS).map(k => wear[k])
  return { worst: Math.max(...vals), mean: vals.reduce((a, b) => a + b, 0) / vals.length }
}
