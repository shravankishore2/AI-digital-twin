/**
 * ENGINE SPECIFICATION
 * Reference powerplant: turbocharged 4-cylinder horizontally-opposed (boxer)
 * aero piston engine, 1211 cc, 84 kW (115 hp) @ 5800 rpm, 2.43:1 reduction
 * gearbox driving a constant-speed propeller. This is the class of engine used
 * in MALE-UAV propulsion (Rotax 912/914-family equivalent).
 *
 * Every number below is the single source of truth for limits, nominal values
 * and units used by the physics model, the health monitor and the HMI.
 */

export const ENGINE = {
  designation: 'AP-4T / 1211cc TC Boxer-4',
  cylinders: 4,
  displacement_cc: 1211,
  ratedPower_kW: 84,
  ratedRPM: 5800,
  idleRPM: 1400,
  gearboxRatio: 2.43,
  criticalAltitude_m: 4900, // turbo maintains rated boost to here
  serviceCeiling_m: 8000,
}

/** Cylinder firing order for a boxer-4 (1-4-3-2 style timing map). */
export const FIRING_ORDER = [0, 3, 2, 1]

/**
 * Parameter registry. `warn`/`alarm` bands drive the gauge arcs, the limit
 * exceedance logic and the alert feed. `lo`/`hi` are the gauge sweep endpoints.
 */
export const PARAMS = {
  rpm:        { label: 'ENGINE RPM',   unit: 'rpm',  lo: 0,    hi: 6200, nominal: 5000, warnHi: 5800, alarmHi: 6000, decimals: 0 },
  propRPM:    { label: 'PROP RPM',     unit: 'rpm',  lo: 0,    hi: 2600, nominal: 2058, warnHi: 2400, alarmHi: 2500, decimals: 0 },
  map:        { label: 'MANIFOLD PRESS', unit: 'inHg', lo: 8,  hi: 44,   nominal: 32,  warnHi: 39.5, alarmHi: 41, decimals: 1 },
  cht:        { label: 'CYL HEAD TEMP', unit: '°C', lo: 20, hi: 160, nominal: 105, warnHi: 120, alarmHi: 135, decimals: 0 },
  egt:        { label: 'EXH GAS TEMP', unit: '°C', lo: 200, hi: 1050, nominal: 845, warnHi: 900, alarmHi: 950, decimals: 0 },
  oilPress:   { label: 'OIL PRESSURE', unit: 'bar',  lo: 0,    hi: 8,    nominal: 3.6, warnLo: 2.0, alarmLo: 1.5, warnHi: 6.5, alarmHi: 7.0, decimals: 2 },
  oilTemp:    { label: 'OIL TEMP',     unit: '°C', lo: 20, hi: 150, nominal: 95,  warnHi: 120, alarmHi: 130, warnLo: 50, decimals: 0 },
  coolantTemp:{ label: 'COOLANT TEMP', unit: '°C', lo: 20, hi: 140, nominal: 88,  warnHi: 110, alarmHi: 120, decimals: 0 },
  fuelFlow:   { label: 'FUEL FLOW',    unit: 'L/h',  lo: 0,    hi: 40,   nominal: 21,  warnHi: 34, alarmHi: 38, decimals: 1 },
  fuelPress:  { label: 'FUEL PRESSURE',unit: 'bar',  lo: 0,    hi: 4.5,  nominal: 3.0, warnLo: 2.2, alarmLo: 1.8, decimals: 2 },
  vibration:  { label: 'VIBRATION',    unit: 'g rms',lo: 0,    hi: 5,    nominal: 1.45, warnHi: 2.4, alarmHi: 3.6, decimals: 2 },
  busVolts:   { label: 'BUS VOLTAGE',  unit: 'V',    lo: 8,    hi: 16,   nominal: 13.8, warnLo: 12.4, alarmLo: 11.5, warnHi: 15.0, alarmHi: 15.5, decimals: 2 },
  altCurrent: { label: 'ALT CURRENT',  unit: 'A',    lo: -20,  hi: 40,   nominal: 12,  warnLo: -1, alarmLo: -6, decimals: 1 },
  lambda:     { label: 'LAMBDA',       unit: 'λ', lo: 0.6, hi: 1.5, nominal: 0.95, warnHi: 1.10, alarmHi: 1.20, warnLo: 0.80, decimals: 3 },
  injDuration:{ label: 'INJ DURATION', unit: 'ms',   lo: 0,    hi: 16,   nominal: 6.4, warnHi: 12, alarmHi: 14, decimals: 2 },
  injTiming:  { label: 'IGN ADVANCE',  unit: '°BTDC', lo: 0, hi: 40, nominal: 24, warnHi: 32, alarmHi: 36, warnLo: 14, decimals: 1 },
  knock:      { label: 'KNOCK INDEX',  unit: '',     lo: 0,    hi: 1,    nominal: 0.05, warnHi: 0.35, alarmHi: 0.6, decimals: 3 },
  boost:      { label: 'BOOST',        unit: 'bar',  lo: -0.5, hi: 0.8,  nominal: 0.22, decimals: 2 },
  power:      { label: 'SHAFT POWER',  unit: 'kW',   lo: 0,    hi: 90,   nominal: 55,  decimals: 1 },
  torque:     { label: 'TORQUE',       unit: 'N·m', lo: 0, hi: 160, nominal: 105, decimals: 1 },
}

/** Engine subsystems tracked by the health monitor & the 3D twin. */
export const SUBSYSTEMS = [
  { id: 'combustion',  label: 'Combustion / Cylinders', short: 'COMB' },
  { id: 'fuel',        label: 'Fuel & Injection',       short: 'FUEL' },
  { id: 'ignition',    label: 'Ignition System',        short: 'IGN'  },
  { id: 'lubrication', label: 'Lubrication',            short: 'OIL'  },
  { id: 'cooling',     label: 'Cooling System',         short: 'COOL' },
  { id: 'mechanical',  label: 'Rotating Assembly',      short: 'MECH' },
  { id: 'induction',   label: 'Induction / Turbo',      short: 'TURBO'},
  { id: 'electrical',  label: 'Electrical / Alternator',short: 'ELEC' },
  { id: 'sensors',     label: 'Sensor Integrity',       short: 'SENS' },
]

/** Wear channels feed the RUL estimator; units are normalised damage 0..1. */
export const WEAR_CHANNELS = {
  cylinder:   { label: 'Piston / Ring Pack',      baseRate: 1.10e-7, subsystem: 'combustion' },
  valvetrain: { label: 'Valvetrain & Seats',      baseRate: 0.90e-7, subsystem: 'combustion' },
  injector:   { label: 'Injector Flow Trim',      baseRate: 1.40e-7, subsystem: 'fuel'       },
  fuelPump:   { label: 'Fuel Pump',               baseRate: 0.70e-7, subsystem: 'fuel'       },
  ignition:   { label: 'Plugs / Coils',           baseRate: 1.80e-7, subsystem: 'ignition'   },
  bearing:    { label: 'Main & Rod Bearings',     baseRate: 0.60e-7, subsystem: 'mechanical' },
  gearbox:    { label: 'Reduction Gearbox',       baseRate: 0.50e-7, subsystem: 'mechanical' },
  oilSystem:  { label: 'Oil Pump & Cooler',       baseRate: 0.80e-7, subsystem: 'lubrication'},
  coolingSys: { label: 'Radiator / Coolant',      baseRate: 1.00e-7, subsystem: 'cooling'    },
  turbo:      { label: 'Turbocharger',            baseRate: 1.20e-7, subsystem: 'induction'  },
  alternator: { label: 'Alternator / Regulator',  baseRate: 0.90e-7, subsystem: 'electrical' },
  sensorSet:  { label: 'Sensor Suite',            baseRate: 0.40e-7, subsystem: 'sensors'    },
}

/** TBO used to scale RUL into engineering units. */
export const TBO_HOURS = 1200

export function bandOf(key, value) {
  const p = PARAMS[key]
  if (!p || value == null || Number.isNaN(value)) return 'unknown'
  if (p.alarmHi != null && value >= p.alarmHi) return 'critical'
  if (p.alarmLo != null && value <= p.alarmLo) return 'critical'
  if (p.warnHi != null && value >= p.warnHi) return 'warning'
  if (p.warnLo != null && value <= p.warnLo) return 'warning'
  return 'good'
}
