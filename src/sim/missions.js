/**
 * MISSION PROFILES
 * A profile is a scripted sequence of flight conditions the twin flies against.
 * Each leg gives target altitude, throttle, airspeed and ISA deviation; the
 * driver interpolates between legs so climbs, descents and throttle transients
 * are continuous rather than stepped.
 */

export const MISSIONS = [
  {
    id: 'isr_endurance',
    name: 'ISR Endurance Orbit',
    blurb: '18 h maritime surveillance pattern. Long low-power loiter — the condition the engine actually spends its life in.',
    icon: 'orbit',
    legs: [
      { t: 0,    name: 'Ground Idle',   alt: 120,  thr: 0.16, ias: 0,  isa: 8 },
      { t: 90,   name: 'Takeoff',       alt: 120,  thr: 1.00, ias: 32, isa: 8 },
      { t: 240,  name: 'Climb',         alt: 3200, thr: 0.92, ias: 42, isa: 4 },
      { t: 600,  name: 'Transit',       alt: 4600, thr: 0.74, ias: 58, isa: 0 },
      { t: 1200, name: 'Loiter Orbit',  alt: 4600, thr: 0.44, ias: 44, isa: 0 },
      { t: 2400, name: 'Loiter Orbit',  alt: 4300, thr: 0.42, ias: 43, isa: 0 },
      { t: 3000, name: 'RTB Descent',   alt: 800,  thr: 0.30, ias: 55, isa: 6 },
      { t: 3300, name: 'Approach',      alt: 150,  thr: 0.38, ias: 34, isa: 8 },
    ],
  },
  {
    id: 'high_alt',
    name: 'High-Altitude Ingress',
    blurb: 'Climb above the turbocharger critical altitude. Boost falls away, EGT rises, cooling airflow thins.',
    icon: 'peak',
    legs: [
      { t: 0,    name: 'Cruise',        alt: 3000, thr: 0.72, ias: 58, isa: 0 },
      { t: 180,  name: 'Max Climb',     alt: 4900, thr: 1.00, ias: 40, isa: 0 },
      { t: 480,  name: 'Above Crit Alt',alt: 6800, thr: 1.00, ias: 38, isa: -4 },
      { t: 780,  name: 'Ceiling Push',  alt: 7800, thr: 1.00, ias: 36, isa: -8 },
      { t: 1080, name: 'On-Station',    alt: 7600, thr: 0.80, ias: 48, isa: -8 },
      { t: 1500, name: 'Descent',       alt: 2500, thr: 0.28, ias: 62, isa: 4 },
    ],
  },
  {
    id: 'hot_day',
    name: 'Hot-and-High Operation',
    blurb: 'ISA +30 desert departure at low airspeed. Cooling margin is at its thinnest — CHT and oil temp lead the story.',
    icon: 'sun',
    legs: [
      { t: 0,    name: 'Hot Idle',      alt: 1400, thr: 0.18, ias: 0,  isa: 32 },
      { t: 120,  name: 'Max Power T/O', alt: 1400, thr: 1.00, ias: 30, isa: 32 },
      { t: 330,  name: 'Slow Climb',    alt: 2600, thr: 0.98, ias: 34, isa: 30 },
      { t: 720,  name: 'Level Off',     alt: 3400, thr: 0.80, ias: 52, isa: 26 },
      { t: 1080, name: 'Cruise',        alt: 3400, thr: 0.70, ias: 56, isa: 24 },
    ],
  },
  {
    id: 'transients',
    name: 'Rapid Throttle Transients',
    blurb: 'Repeated slam accelerations and chops. Tests governor response, thermal shock and knock margin.',
    icon: 'pulse',
    legs: [
      { t: 0,   name: 'Cruise',      alt: 2500, thr: 0.70, ias: 55, isa: 0 },
      { t: 60,  name: 'Slam Open',   alt: 2500, thr: 1.00, ias: 55, isa: 0 },
      { t: 100, name: 'Chop',        alt: 2500, thr: 0.15, ias: 55, isa: 0 },
      { t: 140, name: 'Slam Open',   alt: 2500, thr: 1.00, ias: 55, isa: 0 },
      { t: 180, name: 'Chop',        alt: 2500, thr: 0.15, ias: 55, isa: 0 },
      { t: 220, name: 'Slam Open',   alt: 2500, thr: 0.95, ias: 55, isa: 0 },
      { t: 280, name: 'Stabilise',   alt: 2500, thr: 0.72, ias: 55, isa: 0 },
      { t: 420, name: 'Cruise',      alt: 2500, thr: 0.72, ias: 55, isa: 0 },
    ],
  },
  {
    id: 'manual',
    name: 'Manual / Test Rig',
    blurb: 'Operator-commanded throttle, altitude and OAT. Use this to drive the twin against a test-cell condition.',
    icon: 'slider',
    legs: null,
  },
]

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map(m => [m.id, m]))

/** Interpolate a mission profile to a flight condition at time t (seconds). */
export function conditionAt(mission, t) {
  const legs = mission?.legs
  if (!legs?.length) return null
  const dur = legs[legs.length - 1].t
  const tt = dur > 0 ? t % (dur + 120) : 0        // loop, with a short hold at the end
  let i = 0
  while (i < legs.length - 1 && legs[i + 1].t <= tt) i++
  const a = legs[i], b = legs[Math.min(i + 1, legs.length - 1)]
  const span = Math.max(b.t - a.t, 1e-6)
  const k = b === a ? 1 : Math.min(1, Math.max(0, (tt - a.t) / span))
  // Smoothstep everything except throttle: throttle steps are the point of the
  // transient profile and must stay sharp.
  const sm = k * k * (3 - 2 * k)
  const mix = (x, y, f) => x + (y - x) * f
  return {
    alt_m: mix(a.alt, b.alt, sm),
    throttle: mix(a.thr, b.thr, mission.id === 'transients' ? Math.min(1, k * 6) : sm),
    airspeed_ms: mix(a.ias, b.ias, sm),
    isaDev_C: mix(a.isa, b.isa, sm),
    legName: k < 0.85 ? a.name : b.name,
    legIndex: i, progress: tt / (dur + 120), missionTime: tt, duration: dur + 120,
  }
}
