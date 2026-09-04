/**
 * PHYSICS-BASED ENGINE MODEL  (the "virtual engine" of the Digital Twin)
 *
 * A lumped-parameter thermodynamic + rotational-dynamics model of a
 * turbocharged boxer-4 aero piston engine. It is deterministic given
 * (inputs, modifiers, wear) and is stepped at the telemetry rate.
 *
 * The twin runs TWO instances of this model every tick:
 *   1. the ACTUAL engine  - fault modifiers + accumulated wear applied
 *   2. the REFERENCE engine - pristine, same throttle/altitude/OAT inputs
 * The difference between the two is the residual vector, and every residual is
 * a physically meaningful quantity. That is what makes the ML layer
 * physics-informed rather than a black box fitted to raw signals.
 */

import { ENGINE, PARAMS } from './spec.js'
import { blankModifiers } from './faults.js'

const N = ENGINE.cylinders
const LHV = 43.4e6            // J/kg, avgas/mogas lower heating value
const AFR_STOICH = 14.7
const FUEL_RHO = 0.72         // kg/L
const DISP_M3 = ENGINE.displacement_cc * 1e-6
const R_AIR = 287.05
const INJ_FLOW_G_PER_MS = 0.0031   // g of fuel per ms of injector open time

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
/** First-order lag: pull `cur` toward `tgt` with time constant `tau`. */
const lag = (cur, tgt, tau, dt) => cur + (tgt - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)))

/* ── Atmosphere ─────────────────────────────────────────────────────────── */
export function atmosphere(alt_m, isaDev_C = 0) {
  const theta = 1 - 2.25577e-5 * alt_m
  const p = 101325 * Math.pow(theta, 5.25588)          // Pa
  const T_isa = 288.15 - 0.0065 * alt_m                 // K
  const T = T_isa + isaDev_C
  const rho = p / (R_AIR * T)
  return { p, T, T_C: T - 273.15, rho, sigma: rho / 1.225, delta: p / 101325 }
}

export function createEngineState(amb = atmosphere(0)) {
  return {
    t: 0,
    rpm: ENGINE.idleRPM, propRPM: ENGINE.idleRPM / ENGINE.gearboxRatio,
    map: 10, boost: -0.6, turboRPM: 20000,
    cht: Array(N).fill(amb.T_C + 5), egt: Array(N).fill(amb.T_C + 20),
    compression: Array(N).fill(1), cylBurn: Array(N).fill(1),
    oilTemp: amb.T_C + 3, coolantTemp: amb.T_C + 3, oilPress: 0,
    fuelFlow: 0, fuelPress: 0, lambda: 1, injDuration: 0, injTiming: 24,
    knock: 0, power: 0, torque: 0, ve: 0,
    vibration: 0.2, vibSpectrum: Array(12).fill(0.02), pitch: 1, propPitch: 1, dischargeA: 0,
    busVolts: 12.6, altCurrent: 0, batterySOC: 1,
    egtSpread: 0, chtSpread: 0,
  }
}

/**
 * Advance the engine one timestep.
 * @param s     mutable engine state (returned)
 * @param dt    seconds
 * @param ctx   { throttle 0..1, alt_m, isaDev_C, airspeed_ms, mods, wear, seed }
 */
export function stepEngine(s, dt, ctx) {
  const m = ctx.mods || blankModifiers(N)
  const wear = ctx.wear || {}
  const amb = ctx.amb || atmosphere(ctx.alt_m || 0, ctx.isaDev_C || 0)
  const thr = clamp(ctx.throttle ?? 0.7, 0, 1)
  const ias = ctx.airspeed_ms ?? 55
  s.t += dt

  // Wear silently biases the same physical knobs the faults use, so a worn
  // engine and a faulted engine are not two different code paths.
  const w = k => clamp(wear[k] || 0, 0, 1)
  const turboHealth  = (1 - 0.35 * w('turbo')) * m.boostCap
  const pumpHealth   = (1 - 0.30 * w('oilSystem')) * m.oilPressScale
  const coolHealth   = (1 - 0.25 * w('coolingSys')) * m.coolingEffScale
  const ignHealth    = 1 - 0.20 * w('ignition')
  const ringHealth   = 1 - 0.18 * w('cylinder')
  const altHealth    = (1 - 0.30 * w('alternator')) * m.altOutputScale

  /* ── 1. Induction: turbocharger + manifold pressure ───────────────────── */
  const prMax = 2.55 * turboHealth
  const mapAmbient_inHg = amb.delta * 29.92
  // Wastegate holds rated boost until the compressor runs out of pressure ratio.
  const mapCeiling = Math.min(40.5 * turboHealth, mapAmbient_inHg * prMax)
  const mapIdle = Math.min(10, mapAmbient_inHg * 0.34)
  const mapCmd = lerp(mapIdle, mapCeiling, Math.pow(thr, 1.15)) * m.mapScale
  s.map = lag(s.map, mapCmd, 0.35, dt)
  s.boost = (s.map - mapAmbient_inHg) * 0.033864       // inHg → bar gauge
  const turboTgt = 18000 + 125000 * clamp((s.map - mapIdle) / 30, 0, 1.2) * m.turboSpeedScale
  s.turboRPM = lag(s.turboRPM, turboTgt, 0.8, dt)

  /* ── 2. Volumetric efficiency & air mass flow ─────────────────────────── */
  const rpmN = s.rpm / 4800
  s.ve = clamp((0.72 + 0.22 * Math.exp(-Math.pow((rpmN - 1) / 0.55, 2))) * m.veScale * ringHealth, 0.2, 1.05)
  const T_man = amb.T + 38 + 22 * clamp(s.boost / 0.4, 0, 2)   // post-compressor, post-intercooler
  const rho_man = (s.map * 3386.39) / (R_AIR * T_man)
  const mdotAir = s.ve * DISP_M3 * (s.rpm / 120) * rho_man     // kg/s (4-stroke)

  /* ── 3. Fuel schedule (ECU) & delivered fuel ──────────────────────────── */
  const lambdaTarget = lerp(1.00, 0.86, Math.pow(thr, 1.6))    // enrich for cooling at power
  const trimMean = m.injTrim.reduce((a, b) => a + b, 0) / N
  const injectorHealth = trimMean * (1 - 0.15 * w('injector'))
  const demandFuel = mdotAir / (AFR_STOICH * lambdaTarget)
  const supplyCap = demandFuel * m.fuelDelivCap * (1 - 0.20 * w('fuelPump'))
  let mdotFuel = Math.min(demandFuel * m.fuelScale * injectorHealth, supplyCap)
  mdotFuel = Math.max(mdotFuel, 0)

  s.fuelPress = lag(s.fuelPress, 3.0 * m.fuelPressScale * (1 - 0.18 * w('fuelPump')), 0.5, dt)
  const fuelFlowTgt = (mdotFuel * 3600) / FUEL_RHO             // kg/s → L/h
  s.fuelFlow = lag(s.fuelFlow, fuelFlowTgt, 0.4, dt)

  const lambdaRaw = mdotFuel > 1e-7 ? mdotAir / (AFR_STOICH * mdotFuel) : 1.6
  const lambdaTgt = clamp(lambdaRaw + m.lambdaBias, 0.55, 1.8)
  s.lambda = lag(s.lambda, lambdaTgt, 0.25, dt) + m.lambdaNoise * (Math.random() - 0.5)

  // Injector pulse width the ECU is actually commanding (per cyl, per cycle)
  const fuelPerCylPerCycle_g = (mdotFuel * 1000) / ((s.rpm / 120) * N || 1)
  s.injDuration = clamp(fuelPerCylPerCycle_g / INJ_FLOW_G_PER_MS * m.injDurationScale, 0, 20)

  /* ── 4. Ignition timing & knock ───────────────────────────────────────── */
  const timingMap = 20 + 8 * (1 - thr) + 2.5 * clamp((s.rpm - 3000) / 2500, 0, 1)
  s.injTiming = lag(s.injTiming, clamp(timingMap + m.timingDelta, 0, 40), 0.6, dt)
  const chtMean0 = s.cht.reduce((a, b) => a + b, 0) / N
  const knockDrive =
      0.35 * clamp((chtMean0 - 108) / 30, 0, 1) +
      0.30 * clamp((s.lambda - 1.02) / 0.18, 0, 1) +
      0.25 * clamp((s.map - 34) / 8, 0, 1) +
      0.20 * clamp((s.injTiming - 28) / 8, 0, 1)
  s.knock = clamp(lag(s.knock, 0.03 + 0.55 * knockDrive + m.knockAdd, 0.7, dt), 0, 1)

  /* ── 5. Combustion efficiency & shaft power ───────────────────────────── */
  // Efficiency peaks slightly rich of stoichiometric and falls away either side.
  // Asymmetric: an engine tolerates lean-of-peak further than it tolerates
  // flooding, so the lean arm of the curve is the wider one.
  const lamErr = s.lambda - 0.95
  const lambdaEff = Math.exp(-Math.pow(lamErr / (lamErr > 0 ? 0.42 : 0.28), 2))
  const timingEff = Math.exp(-Math.pow((s.injTiming - timingMap) / 24, 2))
  const cylEff = m.cylCombustion.reduce((a, v, i) => a + v * m.compression[i], 0) / N
  const knockPenalty = 1 - 0.18 * s.knock
  const etaTh = 0.31 * lambdaEff * timingEff * cylEff * knockPenalty * ignHealth
  const powerTgt = clamp(mdotFuel * LHV * etaTh * m.powerScale / 1000, 0, 120)   // kW
  s.power = lag(s.power, powerTgt, 0.25, dt)

  /* ── 6. Rotational dynamics: constant-speed prop + governor ───────────── */
  // The propeller absorbs power by the cube law; the governor trims blade pitch
  // to hold the commanded RPM. When pitch saturates at fine, RPM droops - which
  // is exactly how a real engine reveals that it has stopped making power.
  const rpmCmd = lerp(2400, ENGINE.ratedRPM - 100, Math.pow(thr, 0.85))
  const rpmErr = s.rpm - rpmCmd
  s.pitch = clamp((s.pitch ?? 1) + 0.0016 * rpmErr * dt, 0.30, 1.50)          // integral
  const pitchEff = clamp(s.pitch + 0.00030 * rpmErr, 0.28, 1.55)              // + proportional damping
  const loadPower = 62 * pitchEff * Math.pow(clamp(s.rpm / 5000, 0.05, 1.4), 3)
                  + 1.6 + 2.4 * m.gearboxLoad          // accessories + drag
  const omega = Math.max(s.rpm * Math.PI / 30, 20)
  const J = 0.55                                        // kg·m² at the crankshaft
  const domega = ((s.power - loadPower) * 1000) / (omega * J)
  s.rpm = clamp(s.rpm + domega * (30 / Math.PI) * dt, 0, 6400)
  const ripple = m.rpmRipple * (Math.random() - 0.5) * 2 + 8 * (Math.random() - 0.5)
  s.rpm = clamp(s.rpm + ripple, 0, 6400)
  s.propPitch = s.pitch
  s.propRPM = s.rpm / (ENGINE.gearboxRatio * (1 + m.ratioJitter * (Math.random() - 0.5)))
  s.torque = s.rpm > 100 ? (s.power * 1000) / (s.rpm * Math.PI / 30) : 0

  /* ── 7. Exhaust gas temperature (per cylinder) ────────────────────────── */
  const loadFrac = clamp(s.power / 62, 0, 1.3)
  // Classic EGT-vs-mixture hump: peak just lean of stoichiometric.
  const leanHump = 165 * Math.exp(-Math.pow((s.lambda - 1.06) / 0.16, 2)) - 60 * clamp(0.9 - s.lambda, 0, 0.4) / 0.4
  const retardHeat = 9.5 * clamp(timingMap - s.injTiming, 0, 20)
  for (let c = 0; c < N; c++) {
    const base = 380 + 400 * loadFrac + leanHump + retardHeat
    const cylScale = 0.55 + 0.45 * m.cylCombustion[c]
    // A dead cylinder's probe still sits in a head heat-soaked by its
    // neighbours, so the indication floors well above ambient.
    const floor = s.coolantTemp + 120
    const tgt = Math.max(base * cylScale + m.egtDelta[c], floor)
    // Cycle-to-cycle scatter is added AFTER the thermal lag: it is combustion
    // variability seen by the probe, not a shift in the exhaust gas energy.
    s.egt[c] = lag(s.egt[c], clamp(tgt, amb.T_C, 1200), 2.6, dt)
                 + m.egtNoise[c] * (Math.random() - 0.5)
    s.compression[c] = m.compression[c] * ringHealth
  }
  // Per-cylinder combustion quality, published for the 3D twin: a cylinder that
  // has stopped burning stops flashing on the model.
  s.cylBurn = m.cylCombustion.map((v, i) => v * m.compression[i])

  /* ── 8. Cooling circuit: coolant → CHT → oil ──────────────────────────── */
  const ramFactor = 0.45 + 0.55 * clamp(ias / 60, 0, 1.4)      // airflow through the ducts
  const heatIn = s.power * 0.95 * (1 + 0.25 * s.knock)         // kW rejected to jackets
  const heatDemand = heatIn / 55                                // 1.0 at cruise power
  const rejectCap = Math.max(ramFactor * coolHealth, 0.08)      // normalised radiator capacity
  // Thermostat holds coolant near its set point until rejection capacity runs
  // out; beyond the knee the temperature runs away - that is the overheat trend.
  const coolTgt = 74 + 12 * clamp(heatDemand, 0, 1.25)
                + 44 * clamp(heatDemand / rejectCap - 0.95, 0, 2.5)
                + 0.30 * (amb.T_C - 15) + m.coolantTempDelta
  s.coolantTemp = lag(s.coolantTemp, clamp(coolTgt, amb.T_C, 190), 20, dt)

  for (let c = 0; c < N; c++) {
    const q_in = 26 * (loadFrac + 0.10) * (1 + 0.9 * s.knock) * (0.6 + 0.4 * m.cylCombustion[c])
    const q_out = 0.88 * coolHealth * (s.cht[c] - s.coolantTemp)
    s.cht[c] = clamp(s.cht[c] + (q_in - q_out) * dt * 1.35 + m.chtDelta[c] * dt * 0.30, amb.T_C, 260)
  }

  const oilRej = Math.max(ramFactor * m.oilCoolerScale, 0.12)
  const oilTgt = s.coolantTemp + 8 + 14 * clamp(heatDemand, 0, 1.3) / oilRej
             + m.oilTempDelta + 14 * m.bearingLoad + 9 * m.gearboxLoad
  s.oilTemp = lag(s.oilTemp, clamp(oilTgt, amb.T_C, 200), 24, dt)

  /* ── 9. Oil pressure: pump curve × viscosity(T) × clearance ───────────── */
  const visc = clamp(Math.exp(-(s.oilTemp - 95) / 60), 0.30, 1.75) * m.oilViscosityScale
  const opTgt = clamp(0.22 + 0.00070 * s.rpm * visc * pumpHealth, 0, 7.5)
  s.oilPress = lag(s.oilPress, opTgt, 0.9, dt)

  /* ── 10. Vibration: order-tracked synthetic spectrum ──────────────────── */
  const f1 = s.rpm / 60                     // 1st engine order, Hz
  const fProp = s.propRPM / 60              // prop 1P
  const fMesh = fProp * 39                  // gear-mesh (39-tooth ring)
  const rpmScale = Math.pow(clamp(s.rpm / 5000, 0.15, 1.4), 2)
  const bearingWear = w('bearing'), gearWear = w('gearbox')

  const K = 0.26   // fault-amplitude scaling, calibrated so a single fault sits
                   // in the warning band and a compound fault reaches the limit
  const lines = [
    { f: f1 * 0.5, a: (0.05 + K * m.vibHalfOrder) * rpmScale, w: 5 },      // misfire
    { f: fProp,    a: (0.18 + K * m.vib1P) * rpmScale, w: 4 },              // prop imbalance
    { f: f1,       a: (0.30 + 0.5 * bearingWear) * rpmScale, w: 6 },        // 1st order
    { f: f1 * 2,   a: (0.42 + K * 0.5 * m.vibBroadband) * rpmScale, w: 8 }, // firing order (boxer-4)
    { f: fMesh,    a: (0.10 + K * m.vibMesh + 1.2 * gearWear) * rpmScale, w: 26 }, // gear mesh
    { f: 620,      a: (0.04 + K * 0.9 * m.vibHighFreq) * rpmScale, w: 120 },// knock / metallic
  ]
  const bandEdges = [0, 20, 40, 60, 90, 130, 180, 250, 340, 450, 580, 720, 900]
  const spec = Array(12).fill(0)
  for (let b = 0; b < 12; b++) {
    const fc = (bandEdges[b] + bandEdges[b + 1]) / 2
    const bw = bandEdges[b + 1] - bandEdges[b]
    let acc = 0.012 + (0.06 + K * 0.9 * m.vibBroadband + 0.35 * bearingWear) * rpmScale * 0.30
    // Widen each line to at least the band it lands in, so order energy is
    // captured rather than falling between band centres as RPM sweeps.
    for (const L of lines) acc += L.a * Math.exp(-Math.pow((fc - L.f) / Math.max(L.w, bw * 0.62), 2))
    spec[b] = acc * (0.90 + 0.20 * Math.random())
  }
  s.vibSpectrum = spec
  const vibTgt = Math.sqrt(spec.reduce((a, v) => a + v * v, 0)) * 2.55
  s.vibration = lag(s.vibration, vibTgt, 0.5, dt)

  /* ── 11. Electrical bus ───────────────────────────────────────────────── */
  const altCapable = clamp((s.rpm - 1200) / 1800, 0, 1) * 28 * altHealth
  const busLoad = 11 + m.busLoadExtra
  const charging = altCapable > busLoad
  s.altCurrent = lag(s.altCurrent, charging ? busLoad + 3 : altCapable - busLoad, 0.6, dt) + m.altCurrentDelta
  const BATT_AH = 10
  if (charging) {
    s.busVolts = lag(s.busVolts, 13.9 + m.busVoltDelta, 0.5, dt)
    s.batterySOC = clamp(s.batterySOC + dt / 900, 0, 1)
  } else {
    // Net discharge: SOC falls at load / capacity. This is what turns into the
    // "minutes of ECU power remaining" advisory on an alternator failure.
    s.dischargeA = Math.max(busLoad - altCapable, 0)
    s.batterySOC = clamp(s.batterySOC - (dt * s.dischargeA) / (BATT_AH * 3600), 0, 1)
    s.busVolts = lag(s.busVolts, 11.2 + 1.7 * s.batterySOC + m.busVoltDelta, 2.5, dt)
  }
  if (charging) s.dischargeA = 0
  s.busVolts += m.busRipple * (Math.random() - 0.5)

  const mean = a => a.reduce((x, y) => x + y, 0) / a.length
  s.egtSpread = Math.max(...s.egt) - Math.min(...s.egt)
  s.chtSpread = Math.max(...s.cht) - Math.min(...s.cht)
  s.chtMean = mean(s.cht); s.egtMean = mean(s.egt)
  return s
}

/**
 * Apply sensor-layer effects (bias, dropout, quantisation noise) to the true
 * physical state. Everything downstream of this function sees only what a real
 * ECU/FADEC would put on the CAN bus.
 */
export function sense(truth, mods) {
  const b = mods.sensorBias, f = mods.sensorFail
  const jit = (v, s) => v + s * (Math.random() - 0.5)
  return {
    ...truth,
    cht: truth.cht.map((v, i) => (f.cht[i] ? null : jit(v + b.cht[i], 0.8))),
    egt: truth.egt.map((v, i) => (f.egt[i] ? null : jit(v + b.egt[i], 6))),
    oilPress: Math.max(0, jit(truth.oilPress + b.oilPress, 0.03)),
    oilTemp: jit(truth.oilTemp, 0.4),
    coolantTemp: jit(truth.coolantTemp, 0.4),
    fuelFlow: Math.max(0, jit(truth.fuelFlow, 0.15)),
    map: jit(truth.map, 0.12),
    rpm: jit(truth.rpm, 6),
    vibration: Math.max(0, jit(truth.vibration, 0.02)),
    busVolts: jit(truth.busVolts, 0.02),
    sensorValid: {
      cht: f.cht.map(x => !x),
      egt: f.egt.map(x => !x),
    },
  }
}

export { N as CYL_COUNT, clamp, lerp, lag }
