import React from 'react'
import { bandOf } from '../sim/spec.js'

/** Per-cylinder EGT/CHT with the diagnosed cylinder flagged. Cylinder-level
 *  detail is where nearly every combustion fault first becomes visible. */
export default function CylinderStrip({ sensed, flagCyl, reference }) {
  if (!sensed) return null
  const egt = sensed.egt, cht = sensed.cht
  const valid = sensed.sensorValid
  const mean = a => a.filter(v => v != null).reduce((x, y) => x + y, 0) / Math.max(a.filter(v => v != null).length, 1)
  const eM = mean(egt), cM = mean(cht)

  return (
    <div className="cyls">
      {egt.map((_, i) => {
        const eOk = valid?.egt?.[i] !== false && egt[i] != null
        const cOk = valid?.cht?.[i] !== false && cht[i] != null
        const eb = eOk ? bandOf('egt', egt[i]) : 'unknown'
        const cb = cOk ? bandOf('cht', cht[i]) : 'unknown'
        const dE = eOk ? egt[i] - eM : null
        return (
          <div className={`cyl${flagCyl === i ? ' flag' : ''}`} key={i}>
            <div className="cyl-h">
              <b>CYL {i + 1}</b>
              {flagCyl === i
                ? <span className="chip critical">FAULT</span>
                : <span className={`dot ${cb === 'unknown' ? 'good' : cb}`} />}
            </div>
            <div className="kv"><span className="dim">EGT</span>
              {eOk ? <b className={`v ${eb}`}>{egt[i].toFixed(0)}°</b> : <b className="invalid">INVALID</b>}
            </div>
            <div className="kv"><span className="dim">CHT</span>
              {cOk ? <b className={`v ${cb}`}>{cht[i].toFixed(0)}°</b> : <b className="invalid">INVALID</b>}
            </div>
            <div className="kv"><span className="dim">Δ bank</span>
              <b style={{ color: dE == null ? 'var(--ink-4)' : Math.abs(dE) > 60 ? 'var(--warning)' : 'var(--ink-3)' }}>
                {dE == null ? '—' : `${dE > 0 ? '+' : ''}${dE.toFixed(0)}°`}
              </b>
            </div>
            {!eOk && reference && (
              <div className="kv" style={{ marginTop: 3 }}>
                <span className="dim" style={{ fontSize: 9 }}>MODEL EST</span>
                <b style={{ color: 'var(--accent)', fontSize: 10 }}>{reference.egt[i].toFixed(0)}°</b>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
