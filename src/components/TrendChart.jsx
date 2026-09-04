import React, { useMemo, useRef, useState } from 'react'
import { PARAMS } from '../sim/spec.js'

const fmtT = s => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * Single-parameter trend with its own axis. Deliberately NOT a dual-axis chart:
 * parameters with different units get their own small multiple, so a reader
 * never has to work out which scale a line belongs to.
 */
export default function TrendChart({
  data, accessor, paramKey, label, color = 'var(--s1)', height = 96, showLimits = true, marker,
}) {
  const P = PARAMS[paramKey] || {}
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const W = 600, PAD_L = 34, PAD_R = 8, PAD_T = 8, PAD_B = 16

  const { pts, min, max, t0, t1 } = useMemo(() => {
    const pts = []
    for (const d of data) {
      const v = accessor(d)
      if (v != null && !Number.isNaN(v)) pts.push([d.t, v])
    }
    if (!pts.length) return { pts, min: 0, max: 1, t0: 0, t1: 1 }
    let mn = Infinity, mx = -Infinity
    for (const [, v] of pts) { if (v < mn) mn = v; if (v > mx) mx = v }
    if (showLimits && P.warnHi != null && P.warnHi < mx * 1.6) { mx = Math.max(mx, P.warnHi * 1.02) }
    if (showLimits && P.warnLo != null) { mn = Math.min(mn, P.warnLo * 0.98) }
    const pad = (mx - mn) * 0.14 || Math.abs(mx || 1) * 0.1
    return { pts, min: mn - pad, max: mx + pad, t0: pts[0][0], t1: pts[pts.length - 1][0] }
  }, [data, accessor, P.warnHi, P.warnLo, showLimits])

  if (pts.length < 2) {
    return <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--ink-4)', fontSize: 11 }}>acquiring…</div>
  }

  const span = Math.max(t1 - t0, 1e-6), rng = Math.max(max - min, 1e-9)
  const X = t => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R)
  const Y = v => PAD_T + (1 - (v - min) / rng) * (height - PAD_T - PAD_B)

  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'} ${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  const area = `${d} L ${X(t1).toFixed(1)} ${Y(min).toFixed(1)} L ${X(t0).toFixed(1)} ${Y(min).toFixed(1)} Z`
  const uid = React.useId()

  const gridV = [max, (max + min) / 2, min]

  const onMove = e => {
    const r = ref.current.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const t = t0 + ((x - PAD_L) / (W - PAD_L - PAD_R)) * span
    let best = 0, bd = Infinity
    for (let i = 0; i < pts.length; i++) { const dd = Math.abs(pts[i][0] - t); if (dd < bd) { bd = dd; best = i } }
    setHover({ i: best, px: (X(pts[best][0]) / W) * r.width, py: (Y(pts[best][1]) / height) * r.height })
  }

  // Keyed by side as well as label: a parameter with both a low and a high
  // caution (oil pressure, bus voltage) emits two lines labelled CAUTION.
  const limitLine = (v, c, txt, side) => v == null || v < min || v > max ? null : (
    <g key={`${side}-${txt}`}>
      <line x1={PAD_L} y1={Y(v)} x2={W - PAD_R} y2={Y(v)} stroke={c} strokeWidth="1" strokeDasharray="3 3" opacity="0.75" />
      <text x={W - PAD_R} y={Y(v) - 3} textAnchor="end" fontSize="8.5" fill={c} letterSpacing="0.08em">{txt}</text>
    </g>
  )

  return (
    <div className="chart-wrap" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span className="mono-label">{label ?? P.label}</span>
        <span className="num" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
          {pts[pts.length - 1][1].toFixed(P.decimals ?? 1)} <span style={{ color: 'var(--ink-4)' }}>{P.unit}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridV.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={Y(v)} x2={W - PAD_R} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={PAD_L - 5} y={Y(v) + 3} textAnchor="end" fontSize="8.5" fill="var(--ink-4)" className="num">
              {v.toFixed(P.decimals ?? 1)}
            </text>
          </g>
        ))}
        {showLimits && limitLine(P.warnHi, 'var(--warning)', 'CAUTION', 'hi')}
        {showLimits && limitLine(P.alarmHi, 'var(--critical)', 'LIMIT', 'hi')}
        {showLimits && limitLine(P.warnLo, 'var(--warning)', 'CAUTION', 'lo')}
        {showLimits && limitLine(P.alarmLo, 'var(--critical)', 'LIMIT', 'lo')}
        <path d={area} fill={`url(#g${uid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {marker != null && marker >= t0 && marker <= t1 && (
          <line x1={X(marker)} y1={PAD_T} x2={X(marker)} y2={height - PAD_B} stroke="var(--accent)" strokeWidth="1.5" />
        )}
        {hover && <>
          <line x1={X(pts[hover.i][0])} y1={PAD_T} x2={X(pts[hover.i][0])} y2={height - PAD_B} stroke="var(--line-strong)" strokeWidth="1" />
          <circle cx={X(pts[hover.i][0])} cy={Y(pts[hover.i][1])} r="4" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
        </>}
        <text x={PAD_L} y={height - 3} fontSize="8.5" fill="var(--ink-4)" className="num">{fmtT(t0)}</text>
        <text x={W - PAD_R} y={height - 3} textAnchor="end" fontSize="8.5" fill="var(--ink-4)" className="num">{fmtT(t1)}</text>
      </svg>
      {hover && (
        <div className="tip" style={{
          left: Math.min(Math.max(hover.px + 10, 0), (ref.current?.clientWidth ?? 300) - 130),
          top: Math.max(hover.py - 34, 0),
        }}>
          <div className="tr"><span className="dim">T+{fmtT(pts[hover.i][0])}</span></div>
          <div className="tr"><span>{label ?? P.label}</span><b>{pts[hover.i][1].toFixed(P.decimals ?? 2)} {P.unit}</b></div>
        </div>
      )}
    </div>
  )
}
