import React from 'react'
import { PARAMS, bandOf } from '../sim/spec.js'

const TAU = Math.PI * 2
const START = 140, SWEEP = 260          // degrees: sweep opens downward, gap at the bottom

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
const arcPath = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/**
 * Circular sweep gauge. Band arcs are drawn from the parameter's certified
 * limits, so the coloured regions on the dial are the real caution and
 * exceedance bands rather than decoration.
 */
export default function Gauge({ paramKey, value, size = 120, big = false, label, decimals }) {
  const P = PARAMS[paramKey]
  if (!P) return null
  const lo = P.lo, hi = P.hi
  const valid = value != null && !Number.isNaN(value)
  const v = valid ? Math.min(Math.max(value, lo), hi) : lo
  const band = valid ? bandOf(paramKey, value) : 'unknown'

  const frac = x => (Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)
  const ang = x => START + frac(x) * SWEEP
  const cx = 60, cy = 60
  const R = 47, W = big ? 9 : 7

  // Caution / exceedance segments, low side and high side.
  const segs = []
  if (P.alarmLo != null) segs.push({ a0: START, a1: ang(P.alarmLo), c: 'var(--critical)' })
  if (P.warnLo != null) segs.push({ a0: ang(P.alarmLo ?? lo), a1: ang(P.warnLo), c: 'var(--warning)' })
  if (P.warnHi != null) segs.push({ a0: ang(P.warnHi), a1: ang(P.alarmHi ?? hi), c: 'var(--warning)' })
  if (P.alarmHi != null) segs.push({ a0: ang(P.alarmHi), a1: START + SWEEP, c: 'var(--critical)' })

  const ticks = []
  const NT = big ? 12 : 8
  for (let i = 0; i <= NT; i++) {
    const a = START + (SWEEP * i) / NT
    const major = i % 2 === 0
    const [x0, y0] = polar(cx, cy, R - W - 2, a)
    const [x1, y1] = polar(cx, cy, R - W - (major ? 7 : 4), a)
    ticks.push(<line key={i} x1={x0} y1={y0} x2={x1} y2={y1}
      stroke={major ? 'var(--ink-4)' : 'var(--line-strong)'} strokeWidth={major ? 1.4 : 1} />)
  }

  // The needle lives in the outer annulus only, so it never crosses the digital
  // readout in the centre — the number stays the primary read at a glance.
  const needleA = ang(v)
  const [nx, ny] = polar(cx, cy, R - W - 4, needleA)
  const [bx, by] = polar(cx, cy, R - W - (big ? 21 : 17), needleA)
  const arcLen = (SWEEP / 360) * TAU * R
  const dash = `${frac(v) * arcLen} ${arcLen}`
  const col = { good: 'var(--accent)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical-ink)', unknown: 'var(--ink-4)' }[band]

  return (
    <div className={`gauge${big ? ' big' : ''}`} style={{ maxWidth: size }}>
      <svg viewBox="0 0 120 120" role="img"
        aria-label={`${label ?? P.label} ${valid ? value.toFixed(decimals ?? P.decimals) : 'invalid'} ${P.unit}, ${band}`}>
        <path d={arcPath(cx, cy, R, START, START + SWEEP)} fill="none" stroke="var(--surface-sunk)" strokeWidth={W} strokeLinecap="round" />
        {segs.map((s, i) => s.a1 > s.a0 && (
          <path key={i} d={arcPath(cx, cy, R, s.a0, s.a1)} fill="none" stroke={s.c} strokeWidth={W} opacity="0.5" />
        ))}
        {ticks}
        <path d={arcPath(cx, cy, R, START, START + SWEEP)} fill="none" stroke={col}
          strokeWidth={W} strokeLinecap="round" strokeDasharray={dash}
          style={{ transition: 'stroke-dasharray 130ms linear, stroke 300ms' }} />
        {valid && <>
          <line x1={bx} y1={by} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={big ? 2.4 : 1.9}
            strokeLinecap="round" style={{ transition: 'all 130ms linear' }} />
          <circle cx={nx} cy={ny} r={big ? 2.6 : 2.1} fill="var(--ink)" />
        </>}
      </svg>
      <div className="gauge-read">
        <span className={`v ${band}`}>{valid ? value.toFixed(decimals ?? P.decimals) : '– –'}</span>
        <span className="u">{P.unit}</span>
      </div>
      <div className="gauge-name">{label ?? P.label}</div>
    </div>
  )
}
