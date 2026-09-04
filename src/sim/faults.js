/**
 * FAULT / DEGRADATION LIBRARY
 *
 * Every fault an aero piston engine of this class can realistically present.
 * A fault is not a flag that flips a warning light - it is a *physical modifier*
 * injected into the thermodynamic model. The health monitor and the ML layer
 * downstream see only sensor values, exactly as they would on a real engine, so
 * detection has to be earned rather than announced.
 *
 * Each fault declares:
 *   ramp_s      how long it takes to reach full severity (progressive degradation)
 *   apply(m,i,c) mutates the modifier bundle `m` at intensity `i` (0..1) for cyl `c`
 *   signature   the human-readable evidence chain (fed to the explainable-AI card)
 *   wear        wear channels accelerated while the fault is active
 *   part        the 3D-model component to highlight
 */

export const FAULT_CATEGORIES = [
  { id: 'combustion',  label: 'Combustion & Ignition' },
  { id: 'fuel',        label: 'Fuel & Injection' },
  { id: 'lubrication', label: 'Lubrication & Cooling' },
  { id: 'mechanical',  label: 'Mechanical & Rotating' },
  { id: 'induction',   label: 'Induction & Turbo' },
  { id: 'electrical',  label: 'Electrical' },
  { id: 'sensors',     label: 'Sensor Integrity' },
]

/** Helper: per-cylinder array with a value on one cylinder. */
const onCyl = (arr, c, v) => { arr[c] += v }

export const FAULTS = [
  // ── COMBUSTION & IGNITION ────────────────────────────────────────────────
  {
    id: 'misfire', cat: 'combustion', part: 'cyl', perCylinder: true,
    label: 'Cylinder Misfire', abbr: 'MISFIRE', ramp_s: 12,
    desc: 'Intermittent combustion failure on one cylinder. Charge passes unburned; that cylinder stops making torque.',
    signature: ['EGT collapse on affected cylinder', 'RPM ripple / rough running', '0.5-order vibration rise', 'Shaft power deficit vs commanded MAP'],
    wear: { ignition: 22, cylinder: 6, valvetrain: 3 },
    apply(m, i, c) {
      m.cylCombustion[c] *= (1 - 0.85 * i)
      onCyl(m.egtDelta, c, -260 * i)
      onCyl(m.chtDelta, c, -18 * i)
      m.rpmRipple += 90 * i
      m.vibHalfOrder += 2.2 * i
      m.powerScale *= (1 - 0.24 * i)
      m.fuelScale += 0.05 * i           // unburned charge still injected
      m.lambdaBias += 0.06 * i
    },
  },
  {
    id: 'plug_fouling', cat: 'combustion', part: 'cyl', perCylinder: true,
    label: 'Spark Plug Fouling', abbr: 'PLUG FOUL', ramp_s: 45,
    desc: 'Carbon/lead deposits shunt the spark gap. Combustion becomes late and partial before it fails outright.',
    signature: ['Slow EGT decay on one cylinder', 'Rising cycle-to-cycle variability', 'Mild vibration rise', 'Fuel flow up for same power'],
    wear: { ignition: 30, cylinder: 4 },
    apply(m, i, c) {
      m.cylCombustion[c] *= (1 - 0.35 * i)
      onCyl(m.egtDelta, c, -95 * i)
      m.powerScale *= (1 - 0.08 * i)
      m.fuelScale += 0.02 * i
      // The signature of a fouling plug is cycle-to-cycle VARIABILITY, not a
      // mixture shift: the charge is still metered correctly, it just burns
      // late and inconsistently. That separates it from a flooded cylinder
      // (strongly rich, fuel flow up) and from a dead one (leaner, EGT gone).
      m.egtNoise[c] += 52 * i
      m.rpmRipple += 50 * i
      m.vibHalfOrder += 1.3 * i
    },
  },
  {
    id: 'detonation', cat: 'combustion', part: 'cyl',
    label: 'Detonation / Combustion Instability', abbr: 'DETONATION', ramp_s: 20,
    desc: 'Uncontrolled end-gas auto-ignition. Pressure spikes hammer the piston crown and dump heat into the head.',
    signature: ['Knock index above threshold', 'CHT rising fast on all cylinders', 'High-frequency vibration band energy', 'Correlated with high MAP + lean mixture'],
    wear: { cylinder: 55, valvetrain: 18, bearing: 12 },
    apply(m, i) {
      m.knockAdd += 0.62 * i
      m.chtDelta.forEach((_, k) => { m.chtDelta[k] += 26 * i })
      m.egtDelta.forEach((_, k) => { m.egtDelta[k] += 42 * i })
      m.vibHighFreq += 2.6 * i
      m.powerScale *= (1 - 0.06 * i)
    },
  },
  {
    id: 'ignition_timing', cat: 'combustion', part: 'ecu',
    label: 'Ignition Timing Drift', abbr: 'TIMING DRIFT', ramp_s: 35,
    desc: 'Crank/cam sensor phase error walks the ignition map retarded. Burn completes in the exhaust port.',
    signature: ['Ignition advance below scheduled map', 'EGT elevated across all cylinders', 'Power deficit at constant fuel flow', 'CHT trending up'],
    wear: { ignition: 20, valvetrain: 10, cylinder: 8 },
    apply(m, i) {
      m.timingDelta -= 12 * i
      m.egtDelta.forEach((_, k) => { m.egtDelta[k] += 88 * i })
      m.chtDelta.forEach((_, k) => { m.chtDelta[k] += 12 * i })
      m.powerScale *= (1 - 0.06 * i)
    },
  },
  {
    id: 'valve_leak', cat: 'combustion', part: 'cyl', perCylinder: true,
    label: 'Exhaust Valve Leakage / Compression Loss', abbr: 'VALVE LEAK', ramp_s: 60,
    desc: 'Burnt seat lets combustion gas escape during compression. Cylinder loses trapped mass and torque.',
    signature: ['EGT elevated on one cylinder', 'Compression index falling', 'Power deficit not explained by fuel', 'CHT asymmetry across bank'],
    wear: { valvetrain: 60, cylinder: 20 },
    apply(m, i, c) {
      m.cylCombustion[c] *= (1 - 0.30 * i)
      m.compression[c] *= (1 - 0.34 * i)
      onCyl(m.egtDelta, c, 130 * i)
      onCyl(m.chtDelta, c, 9 * i)
      m.powerScale *= (1 - 0.10 * i)
      m.rpmRipple += 22 * i
    },
  },

  // ── FUEL & INJECTION ─────────────────────────────────────────────────────
  {
    id: 'injector_clog', cat: 'fuel', part: 'injector', perCylinder: true,
    label: 'Injector Clogging', abbr: 'INJ CLOG', ramp_s: 40,
    desc: 'Deposits restrict the injector orifice. That cylinder runs progressively leaner than the ECU believes.',
    signature: ['EGT climbing on one cylinder', 'Lambda leaner than commanded', 'Injector duration compensating upward', 'CHT rise on affected cylinder'],
    wear: { injector: 55, cylinder: 14, valvetrain: 8 },
    apply(m, i, c) {
      m.injTrim[c] *= (1 - 0.45 * i)
      onCyl(m.egtDelta, c, 165 * i)
      onCyl(m.chtDelta, c, 17 * i)
      m.lambdaBias += 0.05 * i
      m.fuelScale -= 0.035 * i
      m.injDurationScale += 0.28 * i   // ECU closed-loop compensation
      m.powerScale *= (1 - 0.07 * i)
    },
  },
  {
    id: 'injector_leak', cat: 'fuel', part: 'injector', perCylinder: true,
    label: 'Injector Stuck Open / Leaking', abbr: 'INJ LEAK', ramp_s: 25,
    desc: 'Injector fails to seat. Raw fuel enters continuously - that cylinder floods and quenches.',
    signature: ['Fuel flow high for commanded power', 'Lambda rich, EGT dropping on that cylinder', 'Bore washing → future ring wear', 'Rough idle / vibration'],
    wear: { injector: 45, cylinder: 30, ignition: 20 },
    apply(m, i, c) {
      m.injTrim[c] *= (1 + 0.6 * i)
      onCyl(m.egtDelta, c, -150 * i)
      m.lambdaBias -= 0.16 * i
      m.fuelScale += 0.20 * i
      m.rpmRipple += 24 * i
      m.cylCombustion[c] *= (1 - 0.18 * i)
    },
  },
  {
    id: 'fuel_pump', cat: 'fuel', part: 'fuelpump',
    label: 'Fuel Pump Degradation / Starvation', abbr: 'FUEL PUMP', ramp_s: 30,
    desc: 'Pump output falls below rail demand. The engine leans out first at high power, where flow demand peaks.',
    signature: ['Fuel rail pressure decaying', 'Lean excursion under high MAP', 'EGT rise across all cylinders', 'Power rolloff at full throttle'],
    wear: { fuelPump: 65, injector: 12, cylinder: 10 },
    apply(m, i) {
      m.fuelPressScale *= (1 - 0.5 * i)
      m.fuelDelivCap = Math.min(m.fuelDelivCap, 1 - 0.22 * i)
      m.lambdaBias += 0.06 * i
      m.egtDelta.forEach((_, k) => { m.egtDelta[k] += 120 * i })
      m.powerScale *= (1 - 0.15 * i)
      m.rpmRipple += 25 * i
    },
  },
  {
    id: 'fuel_contam', cat: 'fuel', part: 'fuelpump',
    label: 'Fuel Contamination / Water Ingress', abbr: 'FUEL CONTAM', ramp_s: 22,
    desc: 'Water or low-octane fuel in the rail. Combustion becomes erratic and knock margin disappears.',
    signature: ['Erratic lambda oscillation', 'Intermittent EGT dropouts on multiple cylinders', 'Knock index elevated', 'Random RPM roughness'],
    wear: { injector: 25, cylinder: 22, fuelPump: 15 },
    apply(m, i) {
      m.lambdaNoise += 0.09 * i
      m.egtNoise.forEach((_, k) => { m.egtNoise[k] += 34 * i })
      m.knockAdd += 0.22 * i
      m.rpmRipple += 55 * i
      m.powerScale *= (1 - 0.09 * i)
      m.cylCombustion.forEach((v, k) => { m.cylCombustion[k] = v * (1 - 0.10 * i) })
    },
  },

  // ── LUBRICATION & COOLING ────────────────────────────────────────────────
  {
    id: 'oil_pressure_loss', cat: 'lubrication', part: 'oilpump',
    label: 'Oil Pressure Loss', abbr: 'OIL PRESS', ramp_s: 18,
    desc: 'Pump wear, a leak or a blocked pickup. Bearing hydrodynamic film collapses - this is the fastest path to engine loss.',
    signature: ['Oil pressure below minimum', 'Oil temperature rising (loss of heat carry-away)', 'Bearing vibration signature emerging', 'Time-to-seizure critical'],
    wear: { oilSystem: 70, bearing: 90, gearbox: 25 },
    apply(m, i) {
      m.oilPressScale *= (1 - 0.80 * i)
      m.oilTempDelta += 18 * i
      m.vibBroadband += 1.9 * i
      m.bearingLoad += 0.9 * i
    },
  },
  {
    id: 'oil_degradation', cat: 'lubrication', part: 'oilpump',
    label: 'Oil Degradation / Viscosity Breakdown', abbr: 'OIL DEGRAD', ramp_s: 70,
    desc: 'Thermal breakdown and shear thin the oil. Pressure sags at temperature while wear metals climb.',
    signature: ['Oil pressure low only when hot', 'Oil temp elevated at constant power', 'Slow broadband vibration creep', 'Pressure-vs-RPM slope degraded'],
    wear: { oilSystem: 40, bearing: 45, gearbox: 20 },
    apply(m, i) {
      m.oilViscosityScale *= (1 - 0.30 * i)
      m.oilTempDelta += 26 * i
      m.vibBroadband += 0.35 * i
      m.bearingLoad += 0.30 * i
    },
  },
  {
    id: 'coolant_loss', cat: 'lubrication', part: 'radiator',
    label: 'Coolant Loss / Cooling Degradation', abbr: 'COOLANT', ramp_s: 40,
    desc: 'Coolant level or pump flow falls. Head rejection capacity drops and CHT walks up on every cylinder.',
    signature: ['Coolant temperature rising', 'CHT rising in lockstep on all cylinders', 'Oil temperature following', 'Knock margin eroding'],
    wear: { coolingSys: 65, cylinder: 35, valvetrain: 25 },
    apply(m, i) {
      // A coolant leak attacks the liquid circuit only: coolant and CHT run
      // away while the oil cooler, on its own duct, stays effective.
      m.coolingEffScale *= (1 - 0.55 * i)
      m.coolantTempDelta += 26 * i
      m.chtDelta.forEach((_, k) => { m.chtDelta[k] += 24 * i })
      m.knockAdd += 0.15 * i
    },
  },
  {
    id: 'radiator_block', cat: 'lubrication', part: 'radiator',
    label: 'Radiator / Oil Cooler Duct Blockage', abbr: 'DUCT BLOCK', ramp_s: 50,
    desc: 'Debris or icing restricts cooling airflow. Rejection falls off with airspeed dependence intact.',
    signature: ['Coolant AND oil temperature both rising', 'Delta grows with power setting', 'No coolant pressure anomaly', 'CHT spread stays symmetric'],
    wear: { coolingSys: 45, oilSystem: 30, cylinder: 20 },
    apply(m, i) {
      // A blocked duct starves BOTH air-side coolers, so the oil circuit is
      // hit as hard as the coolant circuit - that asymmetry is what separates
      // this fault from a coolant leak in the residual space.
      m.coolingEffScale *= (1 - 0.24 * i)
      m.oilCoolerScale *= (1 - 0.66 * i)
      m.coolantTempDelta += 8 * i
      m.oilTempDelta += 30 * i
      m.chtDelta.forEach((_, k) => { m.chtDelta[k] += 10 * i })
    },
  },

  // ── MECHANICAL & ROTATING ────────────────────────────────────────────────
  {
    id: 'bearing_wear', cat: 'mechanical', part: 'crank',
    label: 'Main / Rod Bearing Wear', abbr: 'BEARING', ramp_s: 65,
    desc: 'Babbitt loss increases running clearance. Broadband vibration rises and oil pressure bleeds off through the clearance.',
    signature: ['Broadband vibration energy rising', 'Oil pressure sagging at constant RPM', 'Bearing-order harmonics in spectrum', 'Oil temperature slightly up'],
    wear: { bearing: 80, oilSystem: 25, gearbox: 15 },
    apply(m, i) {
      m.vibBroadband += 2.4 * i
      m.oilPressScale *= (1 - 0.22 * i)
      m.oilTempDelta += 9 * i
      m.bearingLoad += 0.9 * i
    },
  },
  {
    id: 'prop_imbalance', cat: 'mechanical', part: 'prop',
    label: 'Propeller Imbalance / Blade Damage', abbr: 'PROP IMBAL', ramp_s: 8,
    desc: 'Mass or aerodynamic imbalance in the propeller disc. A clean 1-per-rev excitation transmitted through the gearbox.',
    signature: ['Dominant 1P (prop-order) vibration peak', 'Amplitude scales with prop RPM²', 'No thermal or combustion signature', 'Gearbox loading elevated'],
    wear: { gearbox: 70, bearing: 40 },
    apply(m, i) {
      m.vib1P += 3.2 * i
      m.gearboxLoad += 0.9 * i
      m.powerScale *= (1 - 0.04 * i)
    },
  },
  {
    id: 'gearbox_wear', cat: 'mechanical', part: 'gearbox',
    label: 'Reduction Gearbox Wear', abbr: 'GEARBOX', ramp_s: 70,
    desc: 'Gear-tooth pitting and slipper-clutch wear. Energy appears at the gear-mesh frequency, not at engine order.',
    signature: ['Gear-mesh band energy rising', 'Vibration uncorrelated with combustion events', 'Oil temperature creeping up', 'Prop/engine RPM ratio jitter'],
    wear: { gearbox: 85, bearing: 30, oilSystem: 15 },
    apply(m, i) {
      m.vibMesh += 2.8 * i
      m.gearboxLoad += 0.7 * i
      m.oilTempDelta += 7 * i
      m.ratioJitter += 0.012 * i
    },
  },

  // ── INDUCTION & TURBO ────────────────────────────────────────────────────
  {
    id: 'turbo_wastegate', cat: 'induction', part: 'turbo',
    label: 'Turbocharger / Wastegate Fault', abbr: 'TURBO', ramp_s: 25,
    desc: 'Wastegate stuck open or turbine efficiency lost. Boost collapses - and it collapses hardest at altitude.',
    signature: ['MAP below scheduled boost for throttle', 'Power deficit growing with altitude', 'EGT elevated (poor scavenging)', 'Turbo speed / boost-error residual high'],
    wear: { turbo: 75, cylinder: 15 },
    apply(m, i) {
      m.boostCap = Math.min(m.boostCap, 1 - 0.45 * i)
      m.egtDelta.forEach((_, k) => { m.egtDelta[k] += 55 * i })
      m.powerScale *= (1 - 0.20 * i)
      m.turboSpeedScale *= (1 - 0.5 * i)
    },
  },
  {
    id: 'induction_leak', cat: 'induction', part: 'intake',
    label: 'Induction Leak / Filter Clogging', abbr: 'INDUCTION', ramp_s: 45,
    desc: 'Unmetered air past the sensor, or a restricted filter starving the compressor. Either way MAP no longer matches the fuel schedule.',
    signature: ['MAP deficit vs throttle command', 'Lambda lean at low power (leak) or rich at high (restriction)', 'Volumetric-efficiency residual out of band', 'EGT drift across all cylinders'],
    wear: { turbo: 35, cylinder: 18, injector: 10 },
    apply(m, i) {
      m.mapScale *= (1 - 0.24 * i)
      m.lambdaBias += 0.10 * i
      m.veScale *= (1 - 0.15 * i)
      m.turboSpeedScale *= (1 + 0.22 * i)
      m.egtDelta.forEach((_, k) => { m.egtDelta[k] += 45 * i })
      m.powerScale *= (1 - 0.12 * i)
    },
  },

  // ── ELECTRICAL ───────────────────────────────────────────────────────────
  {
    id: 'alternator_fail', cat: 'electrical', part: 'alternator',
    label: 'Alternator Failure / Battery Discharge', abbr: 'ALTERNATOR', ramp_s: 15,
    desc: 'Generator output lost. The bus runs on battery alone - ECU, injectors and ignition are on a countdown.',
    signature: ['Alternator current negative (net discharge)', 'Bus voltage decaying monotonically', 'Battery state-of-charge falling', 'ECU brownout risk on time horizon'],
    wear: { alternator: 80 },
    apply(m, i) {
      m.altOutputScale *= (1 - 0.95 * i)
      m.busLoadExtra += 2 * i
    },
  },
  {
    id: 'regulator_fault', cat: 'electrical', part: 'alternator',
    label: 'Voltage Regulator Fault / Overcharge', abbr: 'REGULATOR', ramp_s: 20,
    desc: 'Regulator loses control of field current. Bus voltage climbs and cooks the battery and the ECU rails.',
    signature: ['Bus voltage above upper limit', 'Alternator current high and unstable', 'Voltage ripple increasing', 'Battery thermal risk'],
    wear: { alternator: 60 },
    apply(m, i) {
      m.busVoltDelta += 2.2 * i
      m.busRipple += 0.35 * i
      m.altCurrentDelta += 14 * i
    },
  },

  // ── SENSOR INTEGRITY ─────────────────────────────────────────────────────
  {
    id: 'sensor_drift', cat: 'sensors', part: 'ecu', perCylinder: true,
    label: 'CHT/EGT Sensor Drift', abbr: 'SENS DRIFT', ramp_s: 55,
    desc: 'Thermocouple junction degradation. The *indication* walks away while the engine itself is healthy - the classic false-alarm generator.',
    signature: ['Indicated CHT/EGT diverging from physics-model prediction', 'No corresponding power, fuel or vibration change', 'Residual grows monotonically, not with load', 'Cross-channel consistency check fails'],
    wear: { sensorSet: 70 },
    apply(m, i, c) {
      m.sensorBias.cht[c] += 34 * i
      m.sensorBias.egt[c] += 130 * i
    },
  },
  {
    id: 'sensor_dropout', cat: 'sensors', part: 'ecu', perCylinder: true,
    label: 'Sensor Dropout / Open Circuit', abbr: 'SENS FAIL', ramp_s: 3,
    desc: 'Open or shorted sensor circuit. The channel goes invalid - the twin must keep flying on its model estimate.',
    signature: ['Channel invalid / out-of-range', 'Zero variance on a live engine', 'Model estimate substituted for indication', 'Redundancy voting triggered'],
    wear: { sensorSet: 50 },
    apply(m, i, c) {
      if (i > 0.5) { m.sensorFail.cht[c] = true; m.sensorFail.egt[c] = true }
    },
  },
  {
    id: 'oilpress_sensor', cat: 'sensors', part: 'oilpump',
    label: 'Oil Pressure Sensor Fault', abbr: 'OP SENSOR', ramp_s: 6,
    desc: 'Transducer reads low while true pressure is normal. Distinguishing this from a real oil emergency is the whole point of a twin.',
    signature: ['Indicated oil pressure low', 'Oil temperature NORMAL (a real loss would heat it)', 'No bearing vibration signature', 'Model residual isolates the sensor, not the pump'],
    wear: { sensorSet: 55 },
    apply(m, i) {
      m.sensorBias.oilPress -= 2.6 * i
    },
  },
]

export const FAULT_BY_ID = Object.fromEntries(FAULTS.map(f => [f.id, f]))

/** A fresh modifier bundle - the identity element of "healthy engine". */
export function blankModifiers(n = 4) {
  return {
    cylCombustion: Array(n).fill(1),
    compression: Array(n).fill(1),
    injTrim: Array(n).fill(1),
    egtDelta: Array(n).fill(0),
    chtDelta: Array(n).fill(0),
    powerScale: 1, fuelScale: 1, mapScale: 1, veScale: 1,
    lambdaBias: 0, lambdaNoise: 0, egtNoise: Array(n).fill(0),
    injDurationScale: 1, timingDelta: 0, knockAdd: 0,
    oilPressScale: 1, oilViscosityScale: 1, oilTempDelta: 0, oilCoolerScale: 1,
    coolingEffScale: 1, coolantTempDelta: 0,
    fuelPressScale: 1, fuelDelivCap: 1, boostCap: 1, turboSpeedScale: 1,
    altOutputScale: 1, busLoadExtra: 0, busVoltDelta: 0, busRipple: 0, altCurrentDelta: 0,
    rpmRipple: 0, ratioJitter: 0,
    vib1P: 0, vibHalfOrder: 0, vibHighFreq: 0, vibBroadband: 0, vibMesh: 0,
    bearingLoad: 0, gearboxLoad: 0,
    sensorBias: { cht: Array(n).fill(0), egt: Array(n).fill(0), oilPress: 0 },
    sensorFail: { cht: Array(n).fill(false), egt: Array(n).fill(false) },
  }
}

/**
 * Collapse the active-fault list into one modifier bundle.
 * @param active  [{ id, cyl, intensity }]
 */
export function buildModifiers(active, n = 4) {
  const m = blankModifiers(n)
  for (const a of active) {
    const f = FAULT_BY_ID[a.id]
    if (!f || a.intensity <= 0) continue
    f.apply(m, a.intensity, a.cyl ?? 0)
  }
  return m
}
