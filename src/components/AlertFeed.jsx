import React from 'react'

const clock = t => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function AlertFeed({ alerts, advisories }) {
  return (
    <div className="rail">
      <div className="panel-head" style={{ borderRadius: 0 }}>
        <h3>Maintenance Advisory</h3>
      </div>
      <div className="panel-body tight" style={{ maxHeight: '46%', overflow: 'auto', flex: 'none' }}>
        {!advisories?.length && (
          <div style={{ color: 'var(--ink-4)', fontSize: 11.5, padding: '10px 4px' }}>
            No action required. All subsystems nominal and no parameter trending toward a limit.
          </div>
        )}
        {advisories?.map(a => (
          <div className={`adv ${a.band}`} key={a.id}>
            <div className="adv-h">
              <span className={`dot ${a.band}`} />
              <b>{a.title}</b>
            </div>
            <div className="adv-line"><em>In flight</em><span>{a.flight}</span></div>
            <div className="adv-line"><em>On ground</em><span>{a.ground}</span></div>
            {a.part && <div className="adv-line"><em>Part</em><span>{a.part} · {a.mmh?.toFixed(1)} mmh</span></div>}
            {a.why?.length > 0 && <ul className="why">{a.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        ))}
      </div>
      <div className="panel-head" style={{ borderRadius: 0, borderTop: '1px solid var(--line)' }}>
        <h3>Event Log</h3>
        <span className="spacer" />
        <span className="mono-label">{alerts?.length ?? 0}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div className="alert-list">
          {!alerts?.length && <div style={{ padding: 14, color: 'var(--ink-4)', fontSize: 11.5 }}>No events logged.</div>}
          {alerts?.map(a => (
            <div className={`alert ${a.band}`} key={a.id}>
              <span className="ts">T+{clock(a.t)}</span>
              <span className="t">{a.title}</span>
              <span className="d">{a.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
