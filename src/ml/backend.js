/**
 * BACKEND SEAM
 *
 * The twin runs fully self-contained on the local physics + ML stack. This
 * module is the single place to swap in a real data source and a real trained
 * model, without touching any component:
 *
 *   1. TELEMETRY  - replace the local simulator with live engine data
 *      (CAN / SocketCAN → ECU-FADEC gateway → WebSocket or REST).
 *   2. INFERENCE  - replace the local Analytics output with a served model
 *      (anomaly score, RUL, classification) from your Python service.
 *
 * Configure with Vite env vars in a .env file:
 *   VITE_TELEMETRY_URL = ws://localhost:8765/telemetry
 *   VITE_INFERENCE_URL = http://localhost:8000/infer
 *
 * If neither is set the twin runs entirely on the built-in models, which is
 * also the offline/edge fallback the GCS uses when the link is degraded.
 */

export const CONFIG = {
  telemetryURL: import.meta.env?.VITE_TELEMETRY_URL || null,
  inferenceURL: import.meta.env?.VITE_INFERENCE_URL || null,
  inferenceHz: Number(import.meta.env?.VITE_INFERENCE_HZ || 2),
}

/* ── TELEMETRY CONTRACT ───────────────────────────────────────────────────
 * One JSON frame per tick, on the WebSocket at VITE_TELEMETRY_URL:
 * {
 *   "t": 1712345678.123,        // epoch seconds
 *   "rpm": 4901, "propRPM": 2017, "map": 30.1, "boost": 0.22,
 *   "cht": [104, 106, 105, 107],       // °C, per cylinder, null if invalid
 *   "egt": [841, 845, 838, 849],       // °C, per cylinder, null if invalid
 *   "oilPress": 3.44, "oilTemp": 99, "coolantTemp": 79,
 *   "fuelFlow": 18.8, "fuelPress": 3.0, "lambda": 0.92,
 *   "injDuration": 6.4, "injTiming": 24.0, "knock": 0.03,
 *   "vibration": 1.47, "vibSpectrum": [ ...12 band RMS... ],
 *   "busVolts": 13.9, "altCurrent": 12.1, "turboRPM": 118000,
 *   "power": 49.6, "torque": 96.8,
 *   "alt_m": 3000, "isaDev_C": 0, "airspeed_ms": 58, "throttle": 0.72
 * }
 * Anything omitted falls back to the twin's model estimate for that channel.
 * ────────────────────────────────────────────────────────────────────────── */

export function createTelemetryLink(url, { onFrame, onStatus }) {
  if (!url) return { close() {}, status: 'local' }
  let ws, closed = false, retry = 0
  const connect = () => {
    if (closed) return
    onStatus?.('connecting')
    ws = new WebSocket(url)
    ws.onopen = () => { retry = 0; onStatus?.('live') }
    ws.onmessage = e => { try { onFrame(JSON.parse(e.data)) } catch { /* malformed frame */ } }
    ws.onclose = () => {
      if (closed) return
      onStatus?.('reconnecting')
      retry = Math.min(retry + 1, 6)
      setTimeout(connect, 500 * 2 ** retry)
    }
    ws.onerror = () => ws.close()
  }
  connect()
  return { close() { closed = true; ws?.close() }, send: d => ws?.readyState === 1 && ws.send(JSON.stringify(d)) }
}

/* ── INFERENCE CONTRACT ───────────────────────────────────────────────────
 * POST VITE_INFERENCE_URL
 * request : { "features": {...}, "residuals": {...}, "window": [[...],[...]] }
 * response: {
 *   "anomaly":  { "score": 0.82, "detected": true },
 *   "faults":   [ { "id": "misfire", "confidence": 0.71, "cylinder": 2 }, ... ],
 *   "rul":      { "hours": 118.4, "confidence": 0.81, "limiting": "bearing" },
 *   "health":   { "overall": 62, "subsystems": { "combustion": 48, ... } }
 * }
 * Any field the service omits keeps the local model's value, so a partially
 * trained backend can be brought online one head at a time.
 * ────────────────────────────────────────────────────────────────────────── */

export async function requestInference(url, payload, signal) {
  if (!url) return null
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`inference ${r.status}`)
  return r.json()
}

/** Merge a served inference result over the local one. Local values survive
 *  wherever the service returned nothing - the twin degrades, never blanks. */
export function mergeInference(local, remote) {
  if (!remote) return local
  const out = { ...local, source: 'remote' }
  if (remote.anomaly) {
    if (typeof remote.anomaly.score === 'number') out.score = remote.anomaly.score
    if (typeof remote.anomaly.detected === 'boolean') out.detected = remote.anomaly.detected
  }
  if (Array.isArray(remote.faults) && remote.faults.length) {
    const byId = Object.fromEntries(local.candidates.map(c => [c.id, c]))
    out.candidates = remote.faults.map(f => ({ ...(byId[f.id] || { id: f.id, label: f.id }), confidence: f.confidence }))
    out.best = out.candidates[0] || null
    if (remote.faults[0]?.cylinder != null) out.cylinder = remote.faults[0].cylinder
  }
  if (remote.rul) out.rul = { ...local.rul, ...remote.rul }
  if (remote.health) {
    out.health = { ...local.health, overall: remote.health.overall ?? local.health.overall }
    if (remote.health.subsystems) {
      out.health.subsystems = local.health.subsystems.map(s =>
        remote.health.subsystems[s.id] != null ? { ...s, value: remote.health.subsystems[s.id] } : s)
    }
  }
  return out
}
