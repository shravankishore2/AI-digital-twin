import React from 'react'
import { PARAMS, bandOf } from '../sim/spec.js'

/** Horizontal bar readout with limit ticks — for parameters where the trend
 *  against a limit matters more than the absolute dial position. */
export default function BarGauge({ paramKey, value, label }) {
  const P = PARAMS[paramKey]
  if (!P) return null
  const valid = value != null && !Number.isNaN(value)
  const band = valid ? bandOf(paramKey, value) : 'unknown'
  const pct = valid ? ((Math.min(Math.max(value, P.lo), P.hi) - P.lo) / (P.hi - P.lo)) * 100 : 0
  const tick = x => x != null ? ((x - P.lo) / (P.hi - P.lo)) * 100 : null
  const ticks = [P.warnLo, P.alarmLo, P.warnHi, P.alarmHi].map(tick).filter(t => t != null)

  return (
    <div className="bar-row">
      <span className="lbl">{label ?? P.label}</span>
      <div className="bar-track">
        <div className={`bar-fill fill-${band === 'unknown' ? 'good' : band}`} style={{ width: `${pct}%`, opacity: valid ? 1 : 0.25 }} />
        {ticks.map((t, i) => <div key={i} className="bar-tick" style={{ left: `${t}%` }} />)}
      </div>
      <span className={`val v ${band}`}>{valid ? value.toFixed(P.decimals) : '– –'}</span>
    </div>
  )
}
