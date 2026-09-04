/**
 * FEATURE EXTRACTION
 * Maps a raw engine state (truth or sensed) onto the fixed feature vector that
 * the anomaly detector, the fault classifier and the health monitor all share.
 * Order is fixed and is the contract for every downstream matrix operation.
 */

export const FEATURES = [
  { key: 'rpm',         label: 'RPM',              sub: 'mechanical'  },
  { key: 'map',         label: 'Manifold Press',   sub: 'induction'   },
  { key: 'power',       label: 'Shaft Power',      sub: 'combustion'  },
  { key: 'chtMean',     label: 'CHT (mean)',       sub: 'cooling'     },
  { key: 'chtDevHi',    label: 'Hottest Cyl ΔCHT', sub: 'combustion'  },
  { key: 'chtDevLo',    label: 'Coolest Cyl ΔCHT', sub: 'combustion'  },
  { key: 'egtMean',     label: 'EGT (mean)',       sub: 'combustion'  },
  { key: 'egtDevHi',    label: 'Hottest Cyl ΔEGT', sub: 'combustion'  },
  { key: 'egtDevLo',    label: 'Coolest Cyl ΔEGT', sub: 'combustion'  },
  { key: 'oilPress',    label: 'Oil Pressure',     sub: 'lubrication' },
  { key: 'oilTemp',     label: 'Oil Temperature',  sub: 'lubrication' },
  { key: 'coolantTemp', label: 'Coolant Temp',     sub: 'cooling'     },
  { key: 'fuelFlow',    label: 'Fuel Flow',        sub: 'fuel'        },
  { key: 'fuelPress',   label: 'Fuel Pressure',    sub: 'fuel'        },
  { key: 'lambda',      label: 'Lambda',           sub: 'fuel'        },
  { key: 'injDuration', label: 'Injector Duration',sub: 'fuel'        },
  { key: 'injTiming',   label: 'Ignition Advance', sub: 'ignition'    },
  { key: 'knock',       label: 'Knock Index',      sub: 'combustion'  },
  { key: 'vibration',   label: 'Vibration RMS',    sub: 'mechanical'  },
  { key: 'vibLow',      label: 'Vib 0-60 Hz',      sub: 'mechanical'  },
  { key: 'vibMid',      label: 'Vib 60-250 Hz',    sub: 'mechanical'  },
  { key: 'vibHigh',     label: 'Vib 250-900 Hz',   sub: 'mechanical'  },
  { key: 'busVolts',    label: 'Bus Voltage',      sub: 'electrical'  },
  { key: 'altCurrent',  label: 'Alternator Current',sub: 'electrical' },
  { key: 'rpmRough',    label: 'RPM Roughness',    sub: 'ignition'    },
  { key: 'egtRoughHi',  label: 'Worst Cyl EGT Variability', sub: 'combustion' },
  { key: 'egtRoughMean',label: 'Mean EGT Variability',      sub: 'combustion' },
  { key: 'turboRPM',    label: 'Turbo Speed',      sub: 'induction'   },
]

/** Per-cylinder localisation channels (deviation from the bank mean). */
export const CYL_FEATURES = ['egtDev', 'chtDev']

export const FEATURE_INDEX = Object.fromEntries(FEATURES.map((f, i) => [f.key, i]))

const sum = a => a.reduce((x, y) => x + (y || 0), 0)

/** Roughness estimator: short-window RPM standard deviation. */
export function rpmRoughness(hist) {
  if (!hist || hist.length < 6) return 0
  const n = Math.min(hist.length, 24)
  const w = hist.slice(-n)
  const mu = sum(w) / n
  return Math.sqrt(sum(w.map(v => (v - mu) ** 2)) / n)
}

/**
 * Build the feature vector. Invalid (dropped-out) sensor channels fall back to
 * the model estimate - the twin keeps flying on its virtual sensor, which is
 * itself one of the deliverables of a digital twin.
 */
/** Short-window standard deviation, per column of a history of vectors. */
export function colStd(hist, n) {
  if (!hist || hist.length < 6) return new Array(n).fill(0)
  const w = hist.slice(-Math.min(hist.length, 30))
  const out = new Array(n).fill(0)
  for (let c = 0; c < n; c++) {
    const mu = sum(w.map(r => r[c])) / w.length
    out[c] = Math.sqrt(sum(w.map(r => (r[c] - mu) ** 2)) / w.length)
  }
  return out
}

/**
 * @param hist { rpm: number[], egtDev: number[][] } recent telemetry window
 */
export function extract(s, ref, hist) {
  const rpmHist = Array.isArray(hist) ? hist : hist?.rpm
  const egtDevHist = Array.isArray(hist) ? null : hist?.egtDev
  const n = s.cht.length
  const valid = (arr, fb) => arr.map((v, i) => (v == null || Number.isNaN(v) ? fb[i] : v))
  const cht = valid(s.cht, ref.cht)
  const egt = valid(s.egt, ref.egt)
  const mean = a => sum(a) / a.length
  const chtMean = mean(cht), egtMean = mean(egt)
  const sp = s.vibSpectrum || Array(12).fill(0)
  const vec = {
    rpm: s.rpm, map: s.map, power: s.power,
    chtMean,
    // SIGNED extremes about the bank mean. A sign-blind spread cannot tell a
    // cylinder running hot (valve leak) from one running cold (flooded
    // injector) - they are opposite faults with identical spreads.
    chtDevHi: Math.max(...cht) - chtMean, chtDevLo: Math.min(...cht) - chtMean,
    egtMean,
    egtDevHi: Math.max(...egt) - egtMean, egtDevLo: Math.min(...egt) - egtMean,
    oilPress: s.oilPress, oilTemp: s.oilTemp, coolantTemp: s.coolantTemp,
    fuelFlow: s.fuelFlow, fuelPress: s.fuelPress, lambda: s.lambda,
    injDuration: s.injDuration, injTiming: s.injTiming, knock: s.knock,
    vibration: s.vibration,
    vibLow: Math.hypot(sp[0], sp[1], sp[2]),
    vibMid: Math.hypot(sp[3], sp[4], sp[5], sp[6]),
    vibHigh: Math.hypot(sp[7], sp[8], sp[9], sp[10], sp[11]),
    busVolts: s.busVolts, altCurrent: s.altCurrent,
    rpmRough: rpmRoughness(rpmHist), turboRPM: s.turboRPM / 1000,
    egtRoughHi: 0, egtRoughMean: 0,
  }
  const rough = colStd(egtDevHist, n)
  vec.egtRoughHi = Math.max(...rough)
  vec.egtRoughMean = sum(rough) / n
  const v = FEATURES.map(f => vec[f.key] ?? 0)
  // Per-cylinder deviations, used purely for spatial localisation.
  const cylDev = { egtDev: egt.map(x => x - egtMean), chtDev: cht.map(x => x - chtMean) }
  return { v, named: vec, cylDev, n }
}
