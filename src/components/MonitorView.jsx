import React, { useState } from 'react'
import Gauge from './Gauge.jsx'
import BarGauge from './BarGauge.jsx'
import Engine3D from './Engine3D.jsx'
import AnomalyPanel from './AnomalyPanel.jsx'
import HealthPanel from './HealthPanel.jsx'
import CylinderStrip from './CylinderStrip.jsx'
import VibSpectrum from './VibSpectrum.jsx'
import FaultConsole from './FaultConsole.jsx'
import MissionBar from './MissionBar.jsx'
import { FAULT_BY_ID } from '../sim/faults.js'

export default function MonitorView({ frame, core, actions }) {
  const [picked, setPicked] = useState(null)
  if (!frame) return null
  const s = frame.sensed, t = frame.truth, a = frame.analysis
  const highlight = a.detected && a.best ? a.best.part : null
  const flagCyl = a.detected ? a.cylinder : null
  const maxCHT = Math.max(...s.cht.filter(v => v != null), 0)
  const maxEGT = Math.max(...s.egt.filter(v => v != null), 0)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 340px) minmax(380px, 1fr) minmax(300px, 360px)', alignItems: 'start' }}>

      {/* ── column 1: instrument cluster ─────────────────────────────── */}
      <div className="grid" style={{ gap: 12 }}>
        <div className="panel">
          <div className="panel-head"><h3>Primary Engine Instruments</h3></div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Gauge paramKey="rpm" value={s.rpm} big size={230} label="Engine RPM" />
            </div>
            <div className="gauge-grid">
              <Gauge paramKey="cht" value={maxCHT} label="CHT max" />
              <Gauge paramKey="egt" value={maxEGT} label="EGT max" />
              <Gauge paramKey="oilPress" value={s.oilPress} label="Oil Press" />
              <Gauge paramKey="oilTemp" value={s.oilTemp} label="Oil Temp" />
              <Gauge paramKey="coolantTemp" value={s.coolantTemp} label="Coolant" />
              <Gauge paramKey="fuelFlow" value={s.fuelFlow} label="Fuel Flow" />
              <Gauge paramKey="map" value={s.map} label="Manifold" />
              <Gauge paramKey="vibration" value={s.vibration} label="Vibration" />
              <Gauge paramKey="busVolts" value={s.busVolts} label="Bus Volts" />
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <BarGauge paramKey="lambda" value={s.lambda} label="Lambda" />
              <BarGauge paramKey="fuelPress" value={s.fuelPress} label="Fuel Press" />
              <BarGauge paramKey="injDuration" value={s.injDuration} label="Inj Pulse" />
              <BarGauge paramKey="injTiming" value={s.injTiming} label="Ign Adv" />
              <BarGauge paramKey="knock" value={s.knock} label="Knock" />
              <BarGauge paramKey="altCurrent" value={s.altCurrent} label="Alt Amps" />
              <BarGauge paramKey="propRPM" value={t.propRPM} label="Prop RPM" />
              <BarGauge paramKey="power" value={t.power} label="Shaft Pwr" />
            </div>
          </div>
        </div>

        <MissionBar
          frame={frame} mission={frame.mission} paused={frame.paused}
          timeScale={frame.timeScale} wearScale={frame.wearScale}
          onMission={actions.setMission} onCommand={actions.setCommand}
          onTimeScale={actions.setTimeScale} onWearScale={actions.setWearScale}
          onPause={actions.togglePause} />
      </div>

      {/* ── column 2: the twin itself ─────────────────────────────────── */}
      <div className="grid" style={{ gap: 12 }}>
        <div className="panel" style={{ height: 460 }}>
          <div className="panel-head">
            <h3>Virtual Engine — Live Synchronised Twin</h3>
            <span className="spacer" />
            <span className="mono-label">4-cyl boxer · turbocharged · 20 Hz sync</span>
          </div>
          <div className="stage">
            <Engine3D frame={frame} highlight={highlight} flagCyl={flagCyl} picked={picked} onPick={setPicked} />
            <div className="stage-tag">
              <span className="tag">RPM {s.rpm.toFixed(0)}</span>
              <span className="tag">PROP {t.propRPM.toFixed(0)}</span>
              <span className="tag">{t.power.toFixed(1)} kW</span>
              <span className="tag">{t.torque.toFixed(0)} N·m</span>
              {highlight && <span className="tag" style={{ color: 'var(--critical-ink)', borderColor: 'rgba(208,59,59,0.55)' }}>
                ▲ {FAULT_BY_ID[a.best.id]?.abbr}{flagCyl != null ? ` · CYL ${flagCyl + 1}` : ''}
              </span>}
            </div>
            <div className="stage-hint">drag to orbit · scroll to zoom · click a cylinder</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Cylinder-Level Monitoring</h3>
            <span className="spacer" />
            <span className="mono-label">EGT spread {t.egtSpread.toFixed(0)}°C · CHT spread {t.chtSpread.toFixed(0)}°C</span>
          </div>
          <div className="panel-body">
            <CylinderStrip sensed={s} flagCyl={flagCyl} reference={frame.reference} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Vibration Signature — Order Tracked</h3>
            <span className="spacer" />
            <span className="mono-label">{s.vibration.toFixed(2)} g rms</span>
          </div>
          <div className="panel-body">
            <VibSpectrum spectrum={t.vibSpectrum} rpm={t.rpm} propRPM={t.propRPM} />
          </div>
        </div>

        <FaultConsole active={frame.active} onInject={actions.inject} onRestore={actions.restore} onReset={actions.fullReset} />
      </div>

      {/* ── column 3: intelligence ────────────────────────────────────── */}
      <div className="grid" style={{ gap: 12 }}>
        <AnomalyPanel analysis={a} />
        <HealthPanel analysis={a} rul={frame.rul} life={frame.life}
          flightHours={frame.flightHours} wearScale={frame.wearScale} />
      </div>
    </div>
  )
}
