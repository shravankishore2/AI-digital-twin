import React from 'react'
import { FEATURES } from '../ml/features.js'

const pct = x => `${Math.round(x * 100)}%`

/**
 * The anomaly verdict. Answers three questions in order: is something wrong,
 * what is it, and why does the twin believe that — the "why" is not optional,
 * because a maintenance engineer will not action a black-box verdict.
 */
export default function AnomalyPanel({ analysis, onLocate }) {
  if (!analysis) return null
  const { detected, score, best, candidates, evidence, cylinder, sensorDoubt } = analysis
  const state = !detected ? 'nominal' : score > 0.7 ? 'alert' : 'warn'
  const band = !detected ? 'good' : score > 0.7 ? 'critical' : 'warning'
  const isSensor = best && ['sensor_drift', 'sensor_dropout', 'oilpress_sensor'].includes(best.id)

  return (
    <div className="panel" style={{ flex: 'none' }}>
      <div className="panel-head">
        <h3>Anomaly Detection</h3>
        <span className="spacer" />
        <span className="mono-label">model-based · {FEATURES.length} residuals</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={`verdict ${state}`}>
          <div className="verdict-head">
            <span className={`dot ${band}`} />
            <span className="state">{detected ? 'ANOMALY — TRUE' : 'ANOMALY — FALSE'}</span>
            <span className="spacer" style={{ marginLeft: 'auto' }} />
            <span className="num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{pct(score)}</span>
          </div>
          <div className="verdict-sub">
            {detected
              ? <>Residual vector is <b>{analysis.magnitude.toFixed(1)}σ</b> off the physics-model prediction.</>
              : <>All {FEATURES.length} residual channels inside the model noise band. Engine tracking its virtual twin.</>}
          </div>
          <div className="score-bar">
            <div style={{
              width: `${score * 100}%`,
              background: score > 0.7 ? 'var(--critical-ink)' : score > 0.35 ? 'var(--warning)' : 'var(--good-ink)',
            }} />
          </div>
        </div>

        {detected && best && (
          <>
            <div>
              <span className="mono-label">Isolated fault · where</span>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 680, lineHeight: 1.25 }}>{best.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 3 }}>
                    <b style={{ color: cylinder != null ? 'var(--critical-ink)' : 'var(--ink-2)' }}>
                      {cylinder != null ? `CYLINDER ${cylinder + 1}` : `${best.cat.toUpperCase()} SUBSYSTEM`}
                    </b>
                    {' · '}severity {pct(Math.min(best.severity, 1))}
                    {' · '}confidence {pct(best.confidence)}
                  </div>
                </div>
                {onLocate && (
                  <button className="btn sm ghost" onClick={() => onLocate(best.part, cylinder)}>Locate</button>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '7px 0 0', lineHeight: 1.5 }}>{best.desc}</p>
            </div>

            {isSensor && (
              <div className="adv warning" style={{ background: 'rgba(250,178,25,0.07)' }}>
                <div className="adv-h">
                  <span className="dot warning" />
                  <b>Instrumentation fault — not an engine fault</b>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                  The affected channel moved with no corroborating change in the physically coupled
                  channels. A threshold alarm would have declared an engine emergency here; the twin
                  isolates it to the sensor and keeps flying on its model estimate.
                </div>
              </div>
            )}

            <div>
              <span className="mono-label">Ranked hypotheses</span>
              <div className="cand" style={{ marginTop: 6 }}>
                {candidates.map(c => (
                  <div className="cand-row" key={c.id}>
                    <span className="nm">{c.label}</span>
                    <span className="cand-meter"><div style={{ width: `${Math.max(2, c.confidence * 100)}%` }} /></span>
                    <span className="pc num">{pct(c.confidence)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <span className="mono-label">
            {detected ? 'Explainable evidence — residual contribution' : 'Largest residuals (all within band)'}
          </span>
          <div className="evi" style={{ marginTop: 6 }}>
            {evidence.slice(0, 5).map(e => (
              <div className="evi-row" key={e.key}>
                <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
                <span className="evi-bar">
                  <div style={{
                    width: `${Math.min(100, e.share * 190)}%`,
                    background: Math.abs(e.z) > 3 ? 'var(--warning)' : 'var(--s1)',
                  }} />
                </span>
                <span className="evi-z num">{e.z > 0 ? '+' : '−'}{Math.abs(e.z).toFixed(1)}σ</span>
              </div>
            ))}
          </div>
          {detected && best && (
            <ul className="why" style={{ marginTop: 8 }}>
              {best.signature.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
