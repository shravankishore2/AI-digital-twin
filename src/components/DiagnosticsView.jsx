import React from 'react'
import TrendChart from './TrendChart.jsx'
import { FEATURES } from '../ml/features.js'

const fmt = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : v.toFixed(d)

/** Full residual table + trend small multiples. This is the engineer's view:
 *  every channel, what the model expected, what the engine did, and the gap. */
export default function DiagnosticsView({ frame, record }) {
  if (!frame) return null
  const a = frame.analysis
  const rows = FEATURES.map((f, i) => ({
    ...f, z: a.z[i],
    observed: a.features[f.key], expected: a.expected[f.key],
    cusum: a.cusum[i],
  })).sort((x, y) => Math.abs(y.z) - Math.abs(x.z))

  const data = record.slice(-720)   // last 3 minutes at 4 Hz

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.15fr)', alignItems: 'start' }}>
      <div className="grid" style={{ gap: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Residual Analysis — Sensed vs Physics Model</h3>
            <span className="spacer" />
            <span className="mono-label">|z| &gt; 3σ flagged</span>
          </div>
          <div className="panel-body flush" style={{ maxHeight: 470 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Channel</th><th style={{ textAlign: 'right' }}>Observed</th>
                  <th style={{ textAlign: 'right' }}>Model</th><th style={{ textAlign: 'right' }}>Residual</th>
                  <th style={{ textAlign: 'right' }}>z</th><th style={{ textAlign: 'right' }}>CUSUM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const hot = Math.abs(r.z) > 3
                  return (
                    <tr key={r.key}>
                      <td className="name">{r.label}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.observed)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.expected)}</td>
                      <td style={{ textAlign: 'right', color: hot ? 'var(--warning)' : 'var(--ink-3)' }}>
                        {r.observed - r.expected > 0 ? '+' : ''}{fmt(r.observed - r.expected)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: hot ? 700 : 400, color: hot ? (Math.abs(r.z) > 6 ? 'var(--critical-ink)' : 'var(--warning)') : 'var(--ink-2)' }}>
                        {r.z > 0 ? '+' : ''}{fmt(r.z, 1)}
                      </td>
                      <td style={{ textAlign: 'right', color: r.cusum > 8 ? 'var(--serious)' : 'var(--ink-4)' }}>{fmt(r.cusum, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Trend Projection — Time to Certified Limit</h3></div>
          <div className="panel-body flush">
            <table className="data">
              <thead>
                <tr><th>Parameter</th><th style={{ textAlign: 'right' }}>Now</th>
                  <th style={{ textAlign: 'right' }}>Slope /min</th><th style={{ textAlign: 'right' }}>Limit</th>
                  <th style={{ textAlign: 'right' }}>Time to limit</th></tr>
              </thead>
              <tbody>
                {a.trends.map(t => (
                  <tr key={t.key}>
                    <td className="name">{t.label}</td>
                    <td style={{ textAlign: 'right' }} className={`v ${t.band}`}>{fmt(t.value, 1)}</td>
                    <td style={{ textAlign: 'right', color: Math.abs(t.slopePerMin ?? 0) > 0.4 ? 'var(--warning)' : 'var(--ink-3)' }}>
                      {t.slopePerMin > 0 ? '+' : ''}{fmt(t.slopePerMin, 2)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{t.target ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: t.ttl != null && t.ttl < 600 ? 700 : 400,
                      color: t.ttl == null ? 'var(--ink-4)' : t.ttl < 300 ? 'var(--critical-ink)' : t.ttl < 900 ? 'var(--warning)' : 'var(--ink-2)' }}>
                      {t.ttl == null ? 'stable' : t.ttl > 3600 ? '> 1 h' : `${(t.ttl / 60).toFixed(1)} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Parameter Trends — Last 3 Minutes</h3>
          <span className="spacer" />
          <span className="mono-label">hover for values</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <TrendChart data={data} accessor={d => d.rpm} paramKey="rpm" color="var(--s1)" />
          <TrendChart data={data} accessor={d => Math.max(...d.cht)} paramKey="cht" label="CHT (hottest cyl)" color="var(--s2)" />
          <TrendChart data={data} accessor={d => Math.max(...d.egt)} paramKey="egt" label="EGT (hottest cyl)" color="var(--s4)" />
          <TrendChart data={data} accessor={d => d.oilPress} paramKey="oilPress" color="var(--s3)" />
          <TrendChart data={data} accessor={d => d.oilTemp} paramKey="oilTemp" color="var(--s2)" />
          <TrendChart data={data} accessor={d => d.coolantTemp} paramKey="coolantTemp" color="var(--s5)" />
          <TrendChart data={data} accessor={d => d.vibration} paramKey="vibration" color="var(--s1)" />
          <TrendChart data={data} accessor={d => d.fuelFlow} paramKey="fuelFlow" color="var(--s3)" />
          <TrendChart data={data} accessor={d => d.lambda} paramKey="lambda" color="var(--s4)" />
          <TrendChart data={data} accessor={d => d.busVolts} paramKey="busVolts" color="var(--s5)" />
          <TrendChart data={data} accessor={d => d.knock} paramKey="knock" color="var(--s2)" />
          <TrendChart data={data} accessor={d => d.power} paramKey="power" color="var(--s1)" showLimits={false} />
        </div>
      </div>
    </div>
  )
}
