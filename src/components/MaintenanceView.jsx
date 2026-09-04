import React from 'react'
import { URGENCY_LABEL } from '../ml/advisory.js'
import { WEAR_CHANNELS, TBO_HOURS } from '../sim/spec.js'
import { CONFIG } from '../ml/backend.js'
import { FEATURES } from '../ml/features.js'

/** Maintenance planning view: what to do, when, and the life-limited-item
 *  schedule that drives it. */
export default function MaintenanceView({ frame }) {
  if (!frame) return null
  const { advisories, rul, wear, flightHours, life } = frame
  const mmh = advisories.reduce((a, x) => a + (x.mmh ?? 0), 0)
  const fmtH = x => x > 9999 ? '>9999' : x >= 100 ? x.toFixed(0) : x.toFixed(1)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(340px, 1fr) minmax(380px, 1.1fr)', alignItems: 'start' }}>
      <div className="grid" style={{ gap: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Autonomous Maintenance Advisory</h3>
            <span className="spacer" />
            <span className="mono-label">
              {advisories.length === 0 ? 'no work raised'
                : `${advisories.length} advisor${advisories.length > 1 ? 'ies' : 'y'}${mmh > 0 ? ` · ${mmh.toFixed(1)} man-hours` : ''}`}
            </span>
          </div>
          <div className="panel-body">
            {!advisories.length && (
              <div style={{ color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.6 }}>
                No maintenance action raised. All subsystem health indices above threshold, no parameter
                trending toward a certified limit, and no life-limited item inside its advisory window.
              </div>
            )}
            {advisories.map(a => (
              <div className={`adv ${a.band}`} key={a.id}>
                <div className="adv-h">
                  <span className={`dot ${a.band}`} />
                  <b>{a.title}</b>
                  <span className={`chip ${a.band}`}>{URGENCY_LABEL[a.urgency]}</span>
                </div>
                <div className="adv-line"><em>In flight</em><span>{a.flight}</span></div>
                <div className="adv-line"><em>On ground</em><span>{a.ground}</span></div>
                {a.part && <div className="adv-line"><em>Parts</em><span>{a.part} — est. {a.mmh?.toFixed(1)} man-hours</span></div>}
                {a.confidence != null && <div className="adv-line"><em>Conf.</em><span>{(a.confidence * 100).toFixed(0)}% diagnostic confidence</span></div>}
                {a.why?.length > 0 && <>
                  <div className="adv-line" style={{ marginTop: 6 }}><em>Evidence</em><span /></div>
                  <ul className="why">{a.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Deployment &amp; Integration Status</h3></div>
          <div className="panel-body">
            <table className="data">
              <tbody>
                {[
                  ['Telemetry source', CONFIG.telemetryURL ? `WebSocket — ${CONFIG.telemetryURL}` : 'Local physics model (edge fallback)'],
                  ['Inference source', CONFIG.inferenceURL ? `REST — ${CONFIG.inferenceURL}` : 'On-board analytics (edge)'],
                  ['Acquisition path', 'CAN 2.0B / SocketCAN → ECU-FADEC gateway → twin ingest'],
                  ['Twin sync rate', '20 Hz physics · 12 Hz HMI publish · 4 Hz mission recording'],
                  ['Detector', `Model-based structured residuals · ${FEATURES.length} channels · EWMA + CUSUM`],
                  ['Classifier', 'Physics-generated fault dictionary · 23 signatures · cosine match'],
                  ['Prognostics', 'Severity-driven cumulative damage → per-channel RUL'],
                  ['Fallback', 'Model estimate substituted for any invalid sensor channel'],
                ].map(([k, v]) => (
                  <tr key={k}><td className="name" style={{ width: '38%' }}>{k}</td><td style={{ fontVariantNumeric: 'normal' }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gap: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Life-Limited Item Schedule</h3>
            <span className="spacer" />
            <span className="mono-label">TBO {TBO_HOURS} h · {flightHours.toFixed(2)} h since new</span>
          </div>
          <div className="panel-body flush">
            <table className="data">
              <thead>
                <tr><th>Component</th><th style={{ textAlign: 'right' }}>Life used</th>
                  <th style={{ textAlign: 'right' }}>Damage rate</th><th style={{ textAlign: 'right' }}>RUL</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rul.channels.map(c => {
                  const band = c.hours < 10 ? 'critical' : c.hours < 50 ? 'serious' : c.hours < 200 ? 'warning' : 'good'
                  const rel = c.ratePerHour / (1 / TBO_HOURS)
                  return (
                    <tr key={c.id}>
                      <td className="name">{c.label}</td>
                      <td style={{ textAlign: 'right' }}>{c.lifeUsedPct.toFixed(3)}%</td>
                      <td style={{ textAlign: 'right', color: rel > 3 ? 'var(--warning)' : 'var(--ink-3)' }}>{rel.toFixed(1)}× nominal</td>
                      <td style={{ textAlign: 'right', fontWeight: band !== 'good' ? 700 : 400 }} className={`v ${band}`}>{fmtH(c.hours)} h</td>
                      <td><span className={`chip ${band}`}>{band === 'good' ? 'ON CONDITION' : band === 'warning' ? 'MONITOR' : band === 'serious' ? 'SCHEDULE' : 'REPLACE'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>How the RUL number is produced</h3></div>
          <div className="panel-body" style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.65 }}>
            <p style={{ marginTop: 0 }}>
              Wear is accumulated per component from <b>operating severity</b>, not from clock time.
              Cylinder head temperature above 110 °C, knock index above 0.30, lean excursions,
              oil pressure below 2.2 bar and vibration above 2.2 g each multiply the damage rate on the
              channels they physically attack — so an hour of hot, knocking, oil-starved running consumes
              far more life than an hour of benign loiter, which is exactly how real engines wear out.
            </p>
            <p>
              RUL for each channel is <span style={{ color: 'var(--ink)' }}>(1 − accumulated damage) ÷ current damage rate</span>,
              and the engine's RUL is the minimum across channels. At nominal cruise this integrates to
              approximately the published {TBO_HOURS}-hour TBO; under an injected fault the limiting
              channel and its rate change immediately, and so does the number.
            </p>
            <p style={{ marginBottom: 0 }}>
              Confidence falls as the current damage rate diverges from the nominal rate the baseline life
              was scheduled against — a long extrapolation off a violent transient is reported as a less
              trustworthy prediction, rather than presented with false precision.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
