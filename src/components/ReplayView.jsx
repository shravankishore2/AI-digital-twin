import React, { useMemo } from 'react'
import TrendChart from './TrendChart.jsx'
import CylinderStrip from './CylinderStrip.jsx'
import Gauge from './Gauge.jsx'
import { MISSIONS } from '../sim/missions.js'

const clock = t => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** POST-FLIGHT ANALYSIS & MISSION REPLAY
 *  Scrub the recorded mission, see the engine state at any instant, and read
 *  the mission-wise health report the twin generated along the way. */
export default function ReplayView({ record, replay, actions, mission }) {
  const n = record.length
  const i = Math.min(replay.index, Math.max(n - 1, 0))
  const f = record[i]

  const summary = useMemo(() => {
    if (!n) return null
    const peak = (fn) => record.reduce((a, d) => Math.max(a, fn(d)), -Infinity)
    const trough = (fn) => record.reduce((a, d) => Math.min(a, fn(d)), Infinity)
    const faults = []
    let cur = null
    for (const d of record) {
      if (d.fault && d.fault !== cur?.id) { cur = { id: d.fault, label: d.faultLabel ?? d.fault, cyl: d.cyl, t0: d.t, t1: d.t }; faults.push(cur) }
      else if (d.fault && cur) cur.t1 = d.t
      else if (!d.fault) cur = null
    }
    return {
      duration: record[n - 1].t - record[0].t,
      peakCHT: peak(d => Math.max(...d.cht)), peakEGT: peak(d => Math.max(...d.egt)),
      minOil: trough(d => d.oilPress), peakVib: peak(d => d.vibration),
      peakOilT: peak(d => d.oilTemp), minHealth: trough(d => d.health),
      rulStart: record[0].rulH, rulEnd: record[n - 1].rulH,
      lifeUsed: record[0].rulH > 0 ? null : null,
      events: faults.filter(x => x.t1 - x.t0 > 1.5),
      anomalyTime: record.filter(d => d.score > 0.4).length / n,
    }
  }, [record, n])

  if (n < 8) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="panel-head"><h3>Mission Replay</h3></div>
        <div className="panel-body" style={{ color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.6 }}>
          Not enough recorded data yet. The twin records the full telemetry, diagnosis and health
          stream at 4 Hz while it runs — return to <b>Live Monitor</b>, let a mission profile run
          (inject a fault or two), then come back to scrub through it.
        </div>
      </div>
    )
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="panel">
        <div className="panel-head">
          <h3>Mission Replay</h3>
          <span className="spacer" />
          <button className="btn sm" onClick={actions.playReplay}>{replay.playing ? '❙❙ Pause' : '▶ Play'}</button>
          <select value={replay.speed} onChange={e => actions.setReplaySpeed(+e.target.value)} style={{ padding: '4px 7px' }}>
            <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={8}>8×</option>
          </select>
          <span className="mono-label">frame {i + 1}/{n}</span>
        </div>
        <div className="panel-body">
          <input type="range" min="0" max={n - 1} step="1" value={i}
            onChange={e => actions.seekReplay(+e.target.value)} aria-label="Mission timeline" />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
            <span className="mono-label">T+{clock(record[0].t)}</span>
            <span style={{ fontSize: 13, fontWeight: 650 }} className="num">
              T+{clock(f.t)} <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 11, letterSpacing: '0.08em' }}>{f.leg}</span>
            </span>
            <span className="mono-label">T+{clock(record[n - 1].t)}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 10, marginTop: 14 }}>
            <Gauge paramKey="rpm" value={f.rpm} label="RPM" />
            <Gauge paramKey="cht" value={Math.max(...f.cht)} label="CHT max" />
            <Gauge paramKey="egt" value={Math.max(...f.egt)} label="EGT max" />
            <Gauge paramKey="oilPress" value={f.oilPress} label="Oil Press" />
            <Gauge paramKey="oilTemp" value={f.oilTemp} label="Oil Temp" />
            <Gauge paramKey="vibration" value={f.vibration} label="Vibration" />
            <Gauge paramKey="fuelFlow" value={f.fuelFlow} label="Fuel Flow" />
            <Gauge paramKey="busVolts" value={f.busVolts} label="Bus Volts" />
          </div>

          <div style={{ marginTop: 14 }}>
            <CylinderStrip sensed={{ cht: f.cht, egt: f.egt, sensorValid: null }} flagCyl={f.fault ? f.cyl : null} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 14,
            borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="kpi"><span className="k">Altitude</span><span className="v" style={{ fontSize: 18 }}>{f.alt_m.toFixed(0)}<span style={{ fontSize: 11, color: 'var(--ink-4)' }}> m</span></span></div>
            <div className="kpi"><span className="k">OAT</span><span className="v" style={{ fontSize: 18 }}>{f.oat.toFixed(0)}<span style={{ fontSize: 11, color: 'var(--ink-4)' }}> °C</span></span></div>
            <div className="kpi"><span className="k">Throttle</span><span className="v" style={{ fontSize: 18 }}>{(f.throttle * 100).toFixed(0)}<span style={{ fontSize: 11, color: 'var(--ink-4)' }}> %</span></span></div>
            <div className="kpi"><span className="k">Health index</span><span className="v" style={{ fontSize: 18, color: f.health < 60 ? 'var(--warning)' : undefined }}>{f.health.toFixed(0)}</span></div>
            <div className="kpi"><span className="k">Anomaly score</span><span className="v" style={{ fontSize: 18, color: f.score > 0.5 ? 'var(--critical-ink)' : undefined }}>{(f.score * 100).toFixed(0)}<span style={{ fontSize: 11, color: 'var(--ink-4)' }}> %</span></span></div>
            <div className="kpi"><span className="k">Diagnosis</span><span className="v" style={{ fontSize: 13, lineHeight: 1.25 }}>{f.fault ? `${f.faultLabel ?? f.fault}${f.cyl != null ? ` · CYL ${f.cyl + 1}` : ''}` : 'Nominal'}</span></div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(420px, 1.35fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-head"><h3>Full Mission Trace</h3><span className="spacer" /><span className="mono-label">marker follows the scrubber</span></div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <TrendChart data={record} accessor={d => d.rpm} paramKey="rpm" color="var(--s1)" marker={f.t} />
            <TrendChart data={record} accessor={d => Math.max(...d.cht)} paramKey="cht" label="CHT (hottest)" color="var(--s2)" marker={f.t} />
            <TrendChart data={record} accessor={d => Math.max(...d.egt)} paramKey="egt" label="EGT (hottest)" color="var(--s4)" marker={f.t} />
            <TrendChart data={record} accessor={d => d.oilPress} paramKey="oilPress" color="var(--s3)" marker={f.t} />
            <TrendChart data={record} accessor={d => d.vibration} paramKey="vibration" color="var(--s5)" marker={f.t} />
            <TrendChart data={record} accessor={d => d.health} paramKey="power" label="Health index" color="var(--s3)" showLimits={false} marker={f.t} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Mission Health Report</h3></div>
          <div className="panel-body">
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 11 }}>
              {MISSIONS.find(m => m.id === mission)?.name ?? 'Mission'} · {(summary.duration / 60).toFixed(1)} min recorded ·
              anomaly present {(summary.anomalyTime * 100).toFixed(0)}% of the sortie
            </div>
            <table className="data">
              <tbody>
                {[
                  ['Peak CHT', `${summary.peakCHT.toFixed(0)} °C`, summary.peakCHT > 120],
                  ['Peak EGT', `${summary.peakEGT.toFixed(0)} °C`, summary.peakEGT > 900],
                  ['Peak oil temp', `${summary.peakOilT.toFixed(0)} °C`, summary.peakOilT > 120],
                  ['Minimum oil pressure', `${summary.minOil.toFixed(2)} bar`, summary.minOil < 2.0],
                  ['Peak vibration', `${summary.peakVib.toFixed(2)} g`, summary.peakVib > 2.4],
                  ['Lowest health index', summary.minHealth.toFixed(0), summary.minHealth < 65],
                  ['RUL at start', `${summary.rulStart > 9999 ? '>9999' : summary.rulStart.toFixed(0)} h`, false],
                  ['RUL at end', `${summary.rulEnd > 9999 ? '>9999' : summary.rulEnd.toFixed(0)} h`, summary.rulEnd < 100],
                ].map(([k, v, bad]) => (
                  <tr key={k}><td className="name">{k}</td>
                    <td style={{ textAlign: 'right', color: bad ? 'var(--warning)' : 'var(--ink)', fontWeight: bad ? 700 : 400 }}>{v}</td></tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 14 }}>
              <span className="mono-label">Diagnosed events</span>
              {!summary.events.length && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 6 }}>None — engine ran nominal for the whole recording.</div>}
              {summary.events.map((e, k) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, marginTop: 6, cursor: 'pointer' }}
                  onClick={() => actions.seekReplay(record.findIndex(r => r.t >= e.t0))}>
                  <span className="dot critical" />
                  <b style={{ flex: 1 }}>{e.label}{e.cyl != null ? ` · CYL ${e.cyl + 1}` : ''}</b>
                  <span className="num dim">T+{clock(e.t0)} → {clock(e.t1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
