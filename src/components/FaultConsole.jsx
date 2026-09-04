import React from 'react'
import { FAULTS, FAULT_CATEGORIES } from '../sim/faults.js'

/**
 * ANOMALY SIMULATION CONSOLE
 *
 * Every fault this class of engine can present, injectable live. Each button
 * arms a *progressive* degradation — the fault ramps in over its own realistic
 * time constant rather than switching on — so what the detector sees is the
 * onset of a real failure, not a step change it could trivially trip on.
 *
 * The detector is never told which button was pressed.
 */
export default function FaultConsole({ active, onInject, onRestore, onReset, compact }) {
  const byCat = FAULT_CATEGORIES.map(c => ({ ...c, items: FAULTS.filter(f => f.cat === c.id) }))
  const act = Object.fromEntries((active ?? []).map(a => [a.id, a]))
  const n = (active ?? []).filter(a => a.target > 0).length

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Anomaly Simulation Console</h3>
        <span className="mono-label" style={{ color: n ? 'var(--critical-ink)' : 'var(--ink-4)' }}>
          {n ? `${n} fault${n > 1 ? 's' : ''} injected` : 'baseline'}
        </span>
        <span className="spacer" />
        <button className="btn primary sm" onClick={onRestore}>↺ Restore Baseline</button>
        {onReset && <button className="btn sm ghost" onClick={onReset} title="Also clears accumulated wear and the mission recording">Reset Twin</button>}
      </div>
      <div className="panel-body tight console">
        {byCat.map(c => (
          <div className="fault-group" key={c.id}>
            <span className="mono-label">{c.label}</span>
            <div className="fault-grid">
              {c.items.map(f => {
                const a = act[f.id]
                const on = !!a && a.target > 0
                return (
                  <button key={f.id} className={`fbtn${on ? ' on' : ''}`} onClick={() => onInject(f.id)}
                    aria-pressed={on} title={f.desc}>
                    {f.abbr}
                    <span className="cy">
                      {on
                        ? `${(a.intensity * 100).toFixed(0)}%${f.perCylinder ? ` · CYL ${a.cyl + 1}` : ''}`
                        : `${f.ramp_s}s onset${f.perCylinder ? ' · per-cyl' : ''}`}
                    </span>
                    {a && <span className="ramp" style={{ width: `${a.intensity * 100}%` }} />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {!compact && (
          <p style={{ fontSize: 10.5, color: 'var(--ink-4)', margin: '2px 0 0', lineHeight: 1.55 }}>
            Faults are injected as physical modifiers into the thermodynamic model — combustion
            efficiency, injector flow trim, pump head, cooling capacity, bearing clearance, sensor bias.
            The detection layer sees only the resulting sensor stream, exactly as it would on the CAN bus.
            Press a lit button again, or Restore Baseline, to clear.
          </p>
        )}
      </div>
    </div>
  )
}
