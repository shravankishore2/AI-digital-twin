import React from 'react'
import { MISSIONS } from '../sim/missions.js'

/** Flight-condition control: pick a scripted mission profile, or fly the
 *  engine manually against a test-cell condition. */
export default function MissionBar({ frame, mission, onMission, onCommand, timeScale, wearScale, onTimeScale, onWearScale, paused, onPause }) {
  const c = frame?.cond ?? {}
  const manual = mission === 'manual'
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Mission &amp; Environment</h3>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onPause}>{paused ? '▶ Resume' : '❙❙ Hold'}</button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <select value={mission} onChange={e => onMission(e.target.value)} aria-label="Mission profile">
          {MISSIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5, minHeight: 32 }}>
          {MISSIONS.find(m => m.id === mission)?.blurb}
        </p>

        {!manual && frame?.missionProgress != null && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono-label">Leg</span>
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{frame.legName}</span>
            </div>
            <div className="bar-track" style={{ marginTop: 5 }}>
              <div className="bar-fill" style={{ width: `${frame.missionProgress * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        )}

        <div className="ctrl">
          <label>Throttle <b>{((c.throttle ?? 0) * 100).toFixed(0)}%</b></label>
          <input type="range" min="0" max="1" step="0.01" value={c.throttle ?? 0.7} disabled={!manual}
            onChange={e => onCommand({ throttle: +e.target.value })} />
        </div>
        <div className="ctrl">
          <label>Altitude <b>{(c.alt_m ?? 0).toFixed(0)} m</b></label>
          <input type="range" min="0" max="8000" step="50" value={c.alt_m ?? 3000} disabled={!manual}
            onChange={e => onCommand({ alt_m: +e.target.value })} />
        </div>
        <div className="ctrl">
          <label>ISA deviation <b>{(c.isaDev_C ?? 0) > 0 ? '+' : ''}{(c.isaDev_C ?? 0).toFixed(0)} °C</b></label>
          <input type="range" min="-20" max="40" step="1" value={c.isaDev_C ?? 0} disabled={!manual}
            onChange={e => onCommand({ isaDev_C: +e.target.value })} />
        </div>
        <div className="ctrl">
          <label>Airspeed (cooling flow) <b>{(c.airspeed_ms ?? 0).toFixed(0)} m/s</b></label>
          <input type="range" min="0" max="90" step="1" value={c.airspeed_ms ?? 58} disabled={!manual}
            onChange={e => onCommand({ airspeed_ms: +e.target.value })} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="ctrl">
            <label>Simulation rate <b>×{timeScale}</b></label>
            <input type="range" min="1" max="8" step="1" value={timeScale} onChange={e => onTimeScale(+e.target.value)} />
          </div>
          <div className="ctrl">
            <label>Life-accrual scale <b>×{wearScale}</b></label>
            <input type="range" min="1" max="500" step="1" value={wearScale} onChange={e => onWearScale(+e.target.value)} />
            <span style={{ fontSize: 9.5, color: 'var(--ink-4)', lineHeight: 1.4 }}>
              Compresses degradation so RUL moves inside a demo. ×1 is real time.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
