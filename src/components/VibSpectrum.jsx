import React, { useState } from 'react'

const EDGES = [0, 20, 40, 60, 90, 130, 180, 250, 340, 450, 580, 720, 900]

/**
 * Order-tracked vibration spectrum. Bands are labelled by the mechanism that
 * lives there, so an operator reads "prop 1P" rather than "band 2" — the whole
 * point of order tracking is that the frequency has a physical name.
 */
export default function VibSpectrum({ spectrum = [], rpm = 0, propRPM = 0 }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(0.35, ...spectrum)
  const f1 = rpm / 60, fProp = propRPM / 60, fMesh = fProp * 39
  const markers = [
    { f: f1 * 0.5, l: '½ order · misfire' },
    { f: fProp, l: 'prop 1P · imbalance' },
    { f: f1 * 2, l: 'firing order' },
    { f: fMesh, l: 'gear mesh' },
  ].filter(m => m.f > 4 && m.f < 900)

  const bandOf = f => { for (let i = 0; i < 12; i++) if (f >= EDGES[i] && f < EDGES[i + 1]) return i; return -1 }
  const marked = new Map()
  for (const m of markers) { const b = bandOf(m.f); if (b >= 0 && !marked.has(b)) marked.set(b, m) }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 78 }}>
        {spectrum.map((v, i) => {
          const h = Math.max(2, (v / max) * 100)
          const m = marked.get(i)
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div style={{
                height: `${h}%`, borderRadius: '4px 4px 0 0',
                background: m ? 'var(--s2)' : 'var(--s1)',
                opacity: hover === null || hover === i ? 1 : 0.45,
                transition: 'height 130ms linear, opacity 140ms',
              }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
        {spectrum.map((_, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 7.5, color: 'var(--ink-4)' }} className="num">
            {EDGES[i + 1]}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.08em', marginTop: 1 }}>BAND UPPER EDGE · Hz</div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--s2)' }} /> order line present</span>
        <span><i className="swatch" style={{ background: 'var(--s1)' }} /> broadband</span>
      </div>
      {hover != null && (
        <div className="tip" style={{ left: `${(hover / 12) * 100}%`, top: -6, transform: 'translateX(-40%)' }}>
          <div className="tr"><span className="dim">{EDGES[hover]}–{EDGES[hover + 1]} Hz</span></div>
          <div className="tr"><span>Band RMS</span><b>{spectrum[hover].toFixed(3)} g</b></div>
          {marked.get(hover) && <div className="tr" style={{ color: 'var(--s2)' }}>{marked.get(hover).l}</div>}
        </div>
      )}
    </div>
  )
}
