"""
AeroTwin reference backend
==========================

Two endpoints, matching the contract the frontend expects (src/ml/backend.js):

  WS   /telemetry   pushes one engine frame per tick  → replaces the local simulator
  POST /infer       returns anomaly / fault / RUL / health → replaces local analytics

Point the frontend at it with a .env file in the project root:

    VITE_TELEMETRY_URL=ws://localhost:8765/telemetry
    VITE_INFERENCE_URL=http://localhost:8765/infer

Run:
    pip install -r backend/requirements.txt
    python backend/server.py

Everything marked  ### YOUR MODEL  is where your trained model goes. Until you
replace them the stubs return neutral values, and the frontend keeps using its
own on-board analytics for anything the service does not answer — so you can
bring one head online at a time without breaking the dashboard.
"""

import asyncio, json, math, random, time
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="AeroTwin backend")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

CYL = 4
TELEMETRY_HZ = 20


# ───────────────────────────── 1. TELEMETRY SOURCE ──────────────────────────
#
# Replace read_engine_frame() with your real acquisition path. For a CAN bus:
#
#     import can
#     bus = can.interface.Bus(channel="can0", bustype="socketcan")
#     msg = bus.recv(timeout=0.1)
#     # decode msg.arbitration_id / msg.data per your ECU-FADEC DBC
#
# or use cantools to decode against a .dbc file:
#
#     import cantools
#     db = cantools.database.load_file("ecu.dbc")
#     sig = db.decode_message(msg.arbitration_id, msg.data)
#
# The frame below is the full channel set the twin understands. Anything you
# omit falls back to the twin's own model estimate for that channel, so a
# partial DBC is fine to start with.

_t0 = time.time()


def read_engine_frame() -> dict[str, Any]:
    """### YOUR MODEL — swap this for real CAN/FADEC acquisition."""
    t = time.time() - _t0
    rpm = 4900 + 40 * math.sin(t * 0.4) + random.gauss(0, 8)
    load = 0.8
    return {
        "t": time.time(),
        "rpm": rpm,
        "propRPM": rpm / 2.43,
        "map": 30.0 + random.gauss(0, 0.15),
        "boost": 0.22,
        "cht": [106 + random.gauss(0, 0.8) + i * 0.4 for i in range(CYL)],
        "egt": [845 + random.gauss(0, 6) + i * 2 for i in range(CYL)],
        "oilPress": 3.44 + random.gauss(0, 0.03),
        "oilTemp": 99 + random.gauss(0, 0.4),
        "coolantTemp": 79 + random.gauss(0, 0.4),
        "fuelFlow": 18.8 + random.gauss(0, 0.15),
        "fuelPress": 3.0,
        "lambda": 0.92,
        "injDuration": 7.4,
        "injTiming": 24.1,
        "knock": 0.03,
        "vibration": 1.45 + random.gauss(0, 0.03),
        "vibSpectrum": [0.05 + 0.3 * math.exp(-((i - 4) ** 2) / 3) for i in range(12)],
        "busVolts": 13.9,
        "altCurrent": 14.0,
        "turboRPM": 118000,
        "power": 49.6 * load,
        "torque": 97.0 * load,
        "alt_m": 3000,
        "isaDev_C": 0,
        "airspeed_ms": 58,
        "throttle": 0.72,
    }


@app.websocket("/telemetry")
async def telemetry(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_text(json.dumps(read_engine_frame()))
            await asyncio.sleep(1 / TELEMETRY_HZ)
    except WebSocketDisconnect:
        pass


# ───────────────────────────── 2. INFERENCE SERVICE ─────────────────────────


class InferRequest(BaseModel):
    features: dict[str, float] = {}
    residuals: dict[str, float] = {}
    window: list[list[float]] = []


# Feature order is fixed by the frontend (src/ml/features.js FEATURES).
FEATURE_ORDER = [
    "rpm", "map", "power", "chtMean", "chtDevHi", "chtDevLo", "egtMean",
    "egtDevHi", "egtDevLo", "oilPress", "oilTemp", "coolantTemp", "fuelFlow",
    "fuelPress", "lambda", "injDuration", "injTiming", "knock", "vibration",
    "vibLow", "vibMid", "vibHigh", "busVolts", "altCurrent", "rpmRough",
    "egtRoughHi", "egtRoughMean", "turboRPM",
]

# Fault ids the frontend knows how to render (src/sim/faults.js).
FAULT_IDS = [
    "misfire", "plug_fouling", "detonation", "ignition_timing", "valve_leak",
    "injector_clog", "injector_leak", "fuel_pump", "fuel_contam",
    "oil_pressure_loss", "oil_degradation", "coolant_loss", "radiator_block",
    "bearing_wear", "prop_imbalance", "gearbox_wear", "turbo_wastegate",
    "induction_leak", "alternator_fail", "regulator_fault", "sensor_drift",
    "sensor_dropout", "oilpress_sensor",
]

# ### YOUR MODEL — load your trained artefacts once, at import time.
#
#   import joblib
#   ANOMALY_MODEL = joblib.load("models/isolation_forest.joblib")
#   FAULT_MODEL   = joblib.load("models/fault_clf.joblib")
#   RUL_MODEL     = joblib.load("models/rul_lgbm.joblib")
#   SCALER        = joblib.load("models/scaler.joblib")
#
# or a PyTorch / ONNX runtime session:
#
#   import onnxruntime as ort
#   SESSION = ort.InferenceSession("models/twin.onnx")
#
ANOMALY_MODEL = None
FAULT_MODEL = None
RUL_MODEL = None


def to_vector(features: dict[str, float]) -> list[float]:
    return [float(features.get(k, 0.0)) for k in FEATURE_ORDER]


@app.post("/infer")
def infer(req: InferRequest):
    x = to_vector(req.features)
    out: dict[str, Any] = {}

    # ── anomaly head ────────────────────────────────────────────────────────
    if ANOMALY_MODEL is not None:
        # score = -ANOMALY_MODEL.score_samples(SCALER.transform([x]))[0]
        # out["anomaly"] = {"score": float(min(max(score, 0.0), 1.0)),
        #                   "detected": bool(score > 0.5)}
        pass

    # ── fault classification head ───────────────────────────────────────────
    if FAULT_MODEL is not None:
        # proba = FAULT_MODEL.predict_proba(SCALER.transform([x]))[0]
        # ranked = sorted(zip(FAULT_MODEL.classes_, proba),
        #                 key=lambda p: -p[1])[:4]
        # out["faults"] = [{"id": str(c), "confidence": float(p)}
        #                  for c, p in ranked if p > 0.02]
        # A per-cylinder fault should also carry {"cylinder": 0..3}.
        pass

    # ── RUL head ────────────────────────────────────────────────────────────
    if RUL_MODEL is not None:
        # hours = float(RUL_MODEL.predict([x])[0])
        # out["rul"] = {"hours": hours, "confidence": 0.8, "limiting": "bearing"}
        pass

    # ── health head ─────────────────────────────────────────────────────────
    # out["health"] = {"overall": 92, "subsystems": {"combustion": 88, ...}}

    # Returning {} is valid: the frontend keeps every local value it already
    # has, so an unfinished backend degrades the twin instead of blanking it.
    return out


@app.get("/health")
def health():
    return {"ok": True, "heads": {
        "anomaly": ANOMALY_MODEL is not None,
        "faults": FAULT_MODEL is not None,
        "rul": RUL_MODEL is not None,
    }}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
