import React from 'react'

const bandOfHealth = v => v >= 85 ? 'good' : v >= 65 ? 'warning' : v >= 40 ? 'serious' : 'critical'

/** Engine health index, subsystem roll-up and remaining useful life. */
export default function HealthPanel({ analysis, rul, life, flightHours, wearScale }) {
  if (!analysis) return null
  const h = analysis.health
  const band = bandOfHealth(h.overall)
  const lim = rul?.limiting
  const rulBand = !lim ? 'good' : lim.hours < 10 ? 'critical' : lim.hours < 50 ? 'serious' : lim.hours < 200 ? 'warning' : 'good'
  const fmtH = x => x > 9999 ? '>9999' : x >= 100 ? x.toFixed(0) : x.toFixed(1)

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Engine Health &amp; Prognostics</h3>
        <span className="spacer" />
        <span className="mono-label">{flightHours.toFixed(2)} h logged</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="kpi">
            <span className="k">Engine Health Index</span>
            <span className={`v ${band}`}>{h.overall.toFixed(0)}<span style={{ fontSize: 14, color: 'var(--ink-4)' }}>/100</span></span>
            <span className="s">
              <span className={`dot ${band}`} style={{ display: 'inline-block', marginRight: 5 }} />
              worst subsystem {h.worst.toFixed(0)}
            </span>
          </div>
          <div className="kpi">
            <span className="k">Remaining Useful Life</span>
            <span className={`v ${rulBand}`}>{fmtH(rul?.hours ?? 0)}<span style={{ fontSize: 14, color: 'var(--ink-4)' }}> h</span></span>
            <span className="s">{lim ? `limited by ${lim.label.toLowerCase()}` : '—'} · conf {(100 * (rul?.confidence ?? 0)).toFixed(0)}%</span>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="mono-label">Subsystem health</span>
            <span className="mono-label">0 — 100</span>
          </div>
          <div style={{ marginTop: 5 }}>
            {h.subsystems.map(s => (
              <div className="bar-row" key={s.id} title={s.drivers.map(d => d.label).join(' · ') || 'nominal'}>
                <span className="lbl">{s.short}</span>
                <div className="bar-track">
                  <div className={`bar-fill fill-${s.band}`} style={{ width: `${s.value}%` }} />
                </div>
                <span className={`val v ${s.band}`}>{s.value.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="mono-label">Life consumed — worst channel {(100 * (life?.worst ?? 0)).toFixed(2)}%</span>
          <div style={{ marginTop: 5 }}>
            {rul?.channels?.slice(0, 5).map(c => (
              <div className="bar-row" key={c.id}>
                <span className="lbl" style={{ fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={c.label}>{c.label.split(' ')[0].replace(/[^\w]/g, '')}</span>
                <div className="bar-track">
                  <div className="bar-fill fill-good"
                    style={{ width: `${Math.max(0.6, c.lifeUsedPct)}%`, background: c.hours < 50 ? 'var(--critical)' : c.hours < 200 ? 'var(--warning)' : undefined }} />
                </div>
                <span className="val num" style={{ color: 'var(--ink-2)', fontSize: 11 }}>{fmtH(c.hours)}h</span>
              </div>
            ))}
          </div>
          {wearScale > 1 && (
            <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 7, letterSpacing: '0.05em' }}>
              ⚠ Life accrual accelerated ×{wearScale} for demonstration — RUL hours are engine hours, not wall-clock.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
