import React, { useEffect } from 'react'
import { useTwin } from './store/useTwin.js'
import MonitorView from './components/MonitorView.jsx'
import DiagnosticsView from './components/DiagnosticsView.jsx'
import ReplayView from './components/ReplayView.jsx'
import MaintenanceView from './components/MaintenanceView.jsx'
import AlertFeed from './components/AlertFeed.jsx'

const TABS = [
  { id: 'monitor', label: 'Live Monitor' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'replay', label: 'Simulation & Replay' },
  { id: 'maintenance', label: 'Maintenance' },
]

const clock = t => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Boot({ stage }) {
  return (
    <div className="boot">
      <div className="boot-inner">
        <h1>AeroTwin</h1>
        <p>Digital Twin · MALE UAV Aero Piston Propulsion</p>
        <div className="boot-bar"><div /></div>
        <div className="boot-stage">{stage}</div>
      </div>
    </div>
  )
}

export default function App() {
  const st = useTwin()
  useEffect(() => { useTwin.getState().boot() }, [])

  if (st.booting || !st.frame) {
    return <Boot stage={st.bootStage === 'ready' ? 'Initialising virtual engine' : st.bootStage} />
  }

  const f = st.frame
  const a = f.analysis
  const band = a.health.band
  const alarm = a.detected && a.score > 0.7
  const actions = {
    inject: st.inject, restore: st.restore, fullReset: st.fullReset,
    setCommand: st.setCommand, setMission: st.setMission,
    setTimeScale: st.setTimeScale, setWearScale: st.setWearScale, togglePause: st.togglePause,
    playReplay: st.playReplay, seekReplay: st.seekReplay, setReplaySpeed: st.setReplaySpeed,
  }
  const record = st.core?.record ?? []

  const setView = v => {
    st.setView(v)
    if (v === 'replay') st.enterReplay(); else st.exitReplay()
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>AeroTwin</b>
          <span>AP-4T · UAV-014</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.id} className="tab" role="tab" aria-selected={st.view === t.id}
              onClick={() => setView(t.id)}>{t.label}</button>
          ))}
        </nav>

        <div className="topbar-right">
          <div className="stat-inline"><b className="num">{clock(f.t)}</b><i>Mission time</i></div>
          <div className="stat-inline"><b className="num">{f.cond.alt_m?.toFixed(0)} m</b><i>Altitude</i></div>
          <div className="stat-inline"><b className="num">{(f.cond.throttle * 100).toFixed(0)}%</b><i>Throttle</i></div>
          <div className="stat-inline"><b className="num">{f.rul.hours > 9999 ? '>9999' : f.rul.hours.toFixed(0)} h</b><i>RUL</i></div>
          <div className="stat-inline">
            <b className={`num v ${band}`}>{a.health.overall.toFixed(0)}</b><i>Health</i>
          </div>
          <span className="link-pill">
            <span className={`dot ${alarm ? 'critical' : a.detected ? 'warning' : 'good'}`} />
            {alarm ? 'Anomaly' : a.detected ? 'Caution' : 'Nominal'}
          </span>
          <span className="link-pill" title={f.live ? 'Live telemetry driving the twin' : 'Running on the on-board physics model'}>
            <span className={`dot ${st.linkStatus === 'reconnecting' ? 'warning' : st.linkStatus === 'connecting' ? 'serious' : 'good'}`} />
            {st.linkStatus === 'local' ? 'Edge · local model'
              : st.linkStatus === 'live' ? (f.live ? 'CAN link · live' : 'Link up · no frames')
              : st.linkStatus}
          </span>
        </div>
      </header>

      <div className="body">
        <main className="main">
          {st.view === 'monitor' && <MonitorView frame={f} core={st.core} actions={actions} />}
          {st.view === 'diagnostics' && <DiagnosticsView frame={f} record={record} />}
          {st.view === 'replay' && <ReplayView record={record} replay={st.replay} actions={actions} mission={f.mission} />}
          {st.view === 'maintenance' && <MaintenanceView frame={f} />}
        </main>
        <AlertFeed alerts={f.alerts} advisories={f.advisories} />
      </div>
    </div>
  )
}
