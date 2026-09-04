# AeroTwin — AI-Enabled Real-Time Digital Twin for MALE-UAV Aero Piston Engines

**SIH Problem Statement 26054 · DRDO · Dept. of Defence Production / iDEX**
*Health monitoring, fault prediction and mission reliability enhancement of aero piston engines used in MALE UAVs.*

A functional software demonstrator of a Digital Twin for a turbocharged 4-cylinder
horizontally-opposed aero piston engine (1211 cc, 84 kW, 2.43:1 reduction gearbox — the
Rotax 912/914 class used in MALE-UAV propulsion). It runs a live virtual engine
synchronised to telemetry, detects and isolates faults before they reach any red line,
estimates remaining useful life, and replays a mission for post-flight analysis.

```bash
npm install
npm run dev          # http://localhost:5173
```

Nothing else is required. The twin runs entirely on the local physics + analytics stack,
which is also the edge/offline fallback when the GCS link is degraded.

---

## What actually makes this a digital twin

The distinguishing claim of a digital twin — as opposed to a dashboard with thresholds —
is that it carries a *model of the machine*, and reasons about the difference between the
model and reality. This one does exactly that, and everything else follows from it.

**Every tick, two virtual engines are stepped side by side:**

| | |
|---|---|
| **ACTUAL** | the physics model with injected faults and accumulated wear applied |
| **REFERENCE** | the same physics model, pristine, driven by the *same* throttle / altitude / OAT commands |

The difference between what the sensors report and what the reference model predicts is
the **residual vector** — 28 physically meaningful channels, each normalised by the
measured healthy noise floor of that channel. This is what the detector consumes.

Two consequences fall straight out of that architecture, and both are the whole point:

- **It catches faults far below any threshold.** A 3σ drift in oil pressure is detected
  while the gauge still reads green, because the model says the pressure should not have
  moved at that RPM and oil temperature.
- **It does not false-alarm on the pilot.** When the operator slams the throttle or climbs
  through the turbocharger critical altitude, every parameter moves violently — and the
  reference model moves with them, so the residuals stay flat. A threshold system alarms
  here. This one does not.

---

## System architecture

```
                 ┌──────────────────────────────────────────────┐
  CAN 2.0B /     │           DIGITAL TWIN CORE  (20 Hz)         │
  SocketCAN  ──▶ │                                              │
  ECU / FADEC    │   ACTUAL engine ◀── faults + wear            │
                 │   REFERENCE engine ◀── same commands, clean  │
                 │        │                                     │
                 │        └──▶ residual vector (28 channels)    │
                 └────────────────────┬─────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
  ANOMALY DETECTION            FAULT ISOLATION               PROGNOSTICS
  EWMA + CUSUM                 physics-generated             severity-driven
  robust Hotelling             fault dictionary,             cumulative damage
  energy statistic             cosine match, ranked          → per-channel RUL
        │                             │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      ▼
             HEALTH INDICES · ADVISORIES · 3D TWIN · MISSION RECORDER
```

### File map

| Path | Role |
|---|---|
| `src/sim/spec.js` | Engine specification, certified limits, subsystems, wear channels |
| `src/sim/engineModel.js` | Lumped-parameter thermodynamic + rotational-dynamics model |
| `src/sim/faults.js` | 23 fault definitions as physical modifiers, with damage tables |
| `src/sim/wear.js` | Severity-driven cumulative damage and the RUL estimator |
| `src/sim/missions.js` | Scripted mission profiles (endurance, high-altitude, hot-day, transients) |
| `src/ml/features.js` | The 28-channel feature vector — the contract for everything downstream |
| `src/ml/dictionary.js` | Self-generated fault signature dictionary |
| `src/ml/analytics.js` | Detection, isolation, localisation, health indices, trend projection |
| `src/ml/advisory.js` | Autonomous maintenance advisory generation |
| `src/ml/backend.js` | **The seam for your telemetry source and your trained model** |
| `src/store/twinCore.js` | Headless twin runtime + mission recorder |
| `src/components/Engine3D.jsx` | Animated 3D virtual engine |
| `backend/server.py` | Reference backend (WebSocket telemetry + REST inference) |
| `model_data/` | Generated 122k-row labelled fault corpus + generator (`npm run data`) |

---

## A. Digital Twin core framework

**Physics model** (`src/sim/engineModel.js`) — a lumped-parameter model stepped at 20 Hz:

- **Induction** — turbocharger pressure-ratio limit and wastegate schedule, so boost holds
  to the 4900 m critical altitude and falls away above it, exactly as the real engine does.
- **Air & fuel** — volumetric efficiency vs RPM, manifold density from MAP and charge
  temperature, ECU lambda schedule enriching for cooling at power, injector flow trim,
  delivery capped by pump head.
- **Combustion** — efficiency as an asymmetric function of lambda (an engine tolerates
  lean-of-peak further than it tolerates flooding), ignition-timing efficiency, per-cylinder
  combustion quality and trapped compression.
- **Rotational dynamics** — constant-speed propeller with a real governor: blade pitch is
  integrated to hold commanded RPM against a cube-law prop load, with proportional damping.
  When pitch saturates fine and the engine still cannot make power, **RPM droops** — which
  is precisely how a real engine reveals a power loss.
- **Thermal** — thermostat-regulated coolant with a rejection-capacity knee, per-cylinder
  CHT from a heat-in/heat-out balance, oil temperature downstream of coolant and bearing load.
- **Lubrication** — pump curve × temperature-dependent viscosity × clearance.
- **Vibration** — an order-tracked synthetic spectrum: ½-order (misfire), prop 1P, first
  engine order, firing order, gear mesh at 39× prop, and a knock band. Bands carry
  mechanism names, not indices.
- **Electrical** — alternator capability vs RPM, bus load, battery state-of-charge with a
  real 10 Ah capacity, so an alternator failure produces a genuine endurance countdown.

**Verified operating points** (all from `stepEngine`, no lookup tables):

| Condition | RPM | MAP | CHT | EGT | Oil P | Oil T | Coolant | Fuel | Power |
|---|---|---|---|---|---|---|---|---|---|
| Cruise, 3000 m | 4893 | 30.0 | 106 °C | 775 °C | 3.44 bar | 99 °C | 79 °C | 18.8 L/h | 50 kW |
| Sea level | 4891 | 30.9 | 113 °C | 778 °C | 3.12 bar | 105 °C | 85 °C | 19.1 L/h | 50 kW |
| 7000 m (above crit alt) | 4889 | 22.5 | 91 °C | 714 °C | 4.16 bar | 87 °C | 69 °C | 15.2 L/h | 40 kW |
| Hot & slow, ISA +25 | 4883 | 30.6 | 116 °C | 752 °C | 2.87 bar | 110 °C | 89 °C | 17.6 L/h | 46 kW |
| Full throttle | 5696 | 40.5 | 141 °C | 835 °C | 2.76 bar | 122 °C | 97 °C | 29.0 L/h | 66 kW |
| Loiter, 35 % | 3759 | 17.0 | 86 °C | 639 °C | 3.30 bar | 86 °C | 73 °C | 7.9 L/h | 21 kW |

**Sensor layer** — everything downstream of `sense()` sees only what a real ECU would put
on the CAN bus: quantisation noise, drift, bias and channel dropout. Where a channel goes
invalid the twin substitutes its own model estimate and says so on the HMI.

---

## B. Health monitoring

All required parameters are monitored, per cylinder where the engine has them: RPM and prop
RPM, CHT ×4, EGT ×4, oil pressure and temperature, coolant temperature, fuel flow and rail
pressure, lambda, injection duration, ignition advance, knock index, vibration RMS plus a
12-band spectrum, bus voltage, alternator current and battery SOC, manifold pressure, boost,
turbo speed, shaft power and torque.

Nine subsystem health indices (0–100) roll up from three independent sources of evidence —
accumulated wear on the components that subsystem owns, live residual magnitude on its
channels, and proximity to certified operating limits. The engine index weights the *worst*
subsystem at 60 %, so one dying subsystem is never averaged away by eight healthy ones.

---

## C. Fault detection & predictive analytics

**23 faults**, injectable live from the Anomaly Simulation Console, covering every category
the problem statement asks for and several it implies:

| Category | Faults |
|---|---|
| Combustion & ignition | misfire, plug fouling, detonation, ignition timing drift, exhaust valve leakage |
| Fuel & injection | injector clogging, injector stuck open, fuel pump degradation, fuel contamination |
| Lubrication & cooling | oil pressure loss, oil degradation, coolant loss, radiator/duct blockage |
| Mechanical | main/rod bearing wear, propeller imbalance, reduction gearbox wear |
| Induction & turbo | turbocharger/wastegate fault, induction leak / filter clogging |
| Electrical | alternator failure, voltage regulator fault |
| Sensor integrity | CHT/EGT sensor drift, sensor dropout, oil pressure transducer fault |

Each fault is injected as a **physical modifier** into the model — combustion efficiency,
injector flow trim, pump head, cooling capacity, bearing clearance, sensor bias — and it
**ramps in over its own realistic time constant** (8 s for a prop strike, 70 s for gearbox
wear). The detector is never told which button was pressed. It sees only the resulting
sensor stream.

### The fault dictionary is generated by the physics model, not hand-labelled

At boot the twin runs ~70 short simulations: three representative operating points healthy
(to measure the residual noise floor of every channel) and each of the 23 faults at full
severity across those same points. The normalised difference is that fault's unit direction
in residual space. That is the classical structured-residual FDI formulation — built
automatically from the plant model rather than from a labelled failure dataset nobody has.

Classification at run time is a cosine match between the live residual direction and the
dictionary, plus a plausibility constraint (no fault can produce a residual louder than its
own full-severity signature), softmaxed into ranked hypotheses.

### Measured performance

Full sweep, every fault injected on cylinder 3, ramped to full severity, cruise at 3000 m:

| Metric | Result |
|---|---|
| False alarms on a healthy engine | **0 / 23 runs** (score 0.000) |
| Top-1 isolation accuracy | **21–22 / 23** |
| Top-2 isolation accuracy | **23 / 23** |
| Cylinder localisation on per-cylinder faults | correct in every case |

The residual top-1 confusions are between physically adjacent faults — a fouling plug is an
incipient misfire, and fuel contamination presents like an intermittent injector leak. In
both cases the true fault ranks second and the HMI shows ranked hypotheses rather than a
single hard call, which is the honest and the operationally useful answer. Reporting
`MISFIRE 67 % / PLUG FOULING 22 %` tells a maintenance engineer to pull the plug first;
inventing certainty would not.

### False-alarm suppression is a first-class feature

Three of the 23 faults are *instrumentation* faults, and they are in the library
deliberately. Inject **OP SENSOR**: indicated oil pressure collapses. A threshold system
declares an engine emergency and the mission is aborted. The twin isolates it to the
transducer — because oil *temperature* is normal, and a real oil-pressure loss cannot
happen without the oil heating up, and there is no bearing vibration signature. The
residual direction for a sensor fault is a single isolated channel; for a real pump failure
it is a coupled cluster. Distinguishing those two is worth more to a MALE-UAV operator than
any amount of detection sensitivity.

---

## D. AI/ML layer

| Function | Method |
|---|---|
| **Anomaly detection** | Model-based residuals over 28 channels → EWMA (fast 0.6 s / slow 3 s) → robust Hotelling energy statistic counting only the part of each residual beyond 2.5σ, so noise never accumulates into a false positive across 28 channels. A one-sided CUSUM in parallel catches slow drifts that never produce a large instantaneous residual. Latched with hysteresis and gated on total residual magnitude. |
| **Fault isolation** | Physics-generated dictionary, cosine match, severity-plausibility constraint, temperature-scaled softmax over the top candidates. |
| **Spatial localisation** | Signed per-cylinder EGT/CHT deviation about the bank mean, oriented by the matched fault's own thermal sign. (A *signed* deviation is essential: a sign-blind spread cannot tell a cylinder running hot from one running cold — opposite faults with identical spreads.) |
| **Trend analysis** | Least-squares slope over a 90 s window per parameter → projected time-to-limit in minutes, with a minimum window so a throttle transient is never mistaken for a trend. |
| **RUL estimation** | Severity-driven cumulative damage across 12 wear channels → `(1 − damage) ÷ current rate`, minimum across channels, with a confidence that falls as the rate diverges from nominal. |
| **Maintenance recommendation** | Rule-based advisory keyed to the isolated fault: in-flight action, ground action, part, man-hours, urgency band, and the residual evidence that produced it. |
| **Explainability** | Every verdict decomposes into named feature contributions with their σ values and the physical evidence chain. There is no unexplained number anywhere in the HMI. |

### How RUL is grounded

Wear accrues from **operating severity**, not clock time. CHT above 110 °C, knock above
0.30, lean excursions, oil pressure below 2.2 bar and vibration above 2.2 g each multiply
the damage rate on the channels they physically attack. Integrated at nominal cruise this
lands on the published 1200-hour TBO — that is the calibration, not a coincidence:

| Condition | Limiting channel | RUL |
|---|---|---|
| Nominal cruise | Plugs / coils | **1223 h** ≈ TBO |
| Sustained detonation | Piston / ring pack | **27 h** |
| Coolant loss | Radiator / coolant | **11 h** |
| Oil pressure loss | Main & rod bearings | **10 h** |

The *Life-accrual scale* control compresses degradation for demonstration so RUL moves
inside a five-minute demo. It is labelled on the HMI; ×1 is real time.

---

## E. Simulation & replay

Four scripted mission profiles, each chosen because it stresses a different failure mode:

- **ISR Endurance Orbit** — 18 h maritime pattern; long low-power loiter, the condition the
  engine actually spends its life in.
- **High-Altitude Ingress** — climb through the turbocharger critical altitude; boost falls
  away, EGT rises, cooling airflow thins.
- **Hot-and-High Operation** — ISA +30 desert departure at low airspeed; cooling margin at
  its thinnest.
- **Rapid Throttle Transients** — repeated slam accelerations and chops; governor response,
  thermal shock and knock margin.

Plus **Manual / Test Rig**, where throttle, altitude, ISA deviation and airspeed are driven
directly — the mode to use against a test-cell condition.

The twin records telemetry, diagnosis and health at 4 Hz for 30 minutes. **Simulation &
Replay** scrubs that recording frame by frame with the full instrument panel, a marked
mission trace, and a mission health report: peak CHT/EGT/oil temperature, minimum oil
pressure, peak vibration, lowest health index, RUL consumed, and every diagnosed event with
its time window (click one to jump to it).

---

## F. Visualization dashboard

Four views, dark-first for a low-light GCS:

- **Live Monitor** — instrument cluster with certified caution/exceedance bands drawn from
  the real limits; the animated 3D virtual engine; cylinder-level EGT/CHT; order-tracked
  vibration spectrum; the anomaly verdict with ranked hypotheses and evidence; health and
  RUL; and the anomaly simulation console.
- **Diagnostics** — the full 28-channel residual table (observed / model / residual / z /
  CUSUM), time-to-limit projections, and 12 trend charts with limit reference lines.
- **Simulation & Replay** — mission scrubber and post-flight report.
- **Maintenance** — advisories with evidence, the life-limited item schedule with damage
  rates relative to nominal, and deployment/integration status.

### The 3D twin

Procedurally built from the engine specification, so it stays consistent with the model:
crankcase, four opposed finned cylinders with heads and rocker covers, injectors and plugs,
intake plenum, exhaust stubs, turbocharger with a spinning turbine, reduction gearbox,
three-blade propeller, oil pan and pump, radiator core, alternator and ECU.

It is driven by live state, not decoration:

- Cylinder surfaces are **coloured by their own CHT** and exhaust stubs glow with EGT.
- Each cylinder **flashes on its firing event**, timed on the real firing order at the true
  firing frequency — so a **misfiring cylinder visibly stops firing**.
- The propeller turns at prop RPM, the turbine at turbo speed.
- The diagnosed component **pulses with a halo**, and the flagged cylinder turns red.
- Orbit, zoom, and click a cylinder to select it.

---

## Connecting your telemetry and your trained model

`src/ml/backend.js` is the only file that needs to know a backend exists. Copy
`.env.example` to `.env`:

```bash
VITE_TELEMETRY_URL=ws://localhost:8765/telemetry
VITE_INFERENCE_URL=http://localhost:8765/infer
```

A runnable reference server is in `backend/server.py` (FastAPI):

```bash
pip install -r backend/requirements.txt
python backend/server.py
```

Every place your model goes is marked `### YOUR MODEL`, with commented examples for
scikit-learn/joblib, ONNX Runtime, and SocketCAN + cantools acquisition.

**Telemetry contract** — one JSON frame per tick on the WebSocket. Any channel you omit
falls back to the twin's model estimate, so a partial DBC works from day one.

**Inference contract** — `POST /infer` with `{features, residuals, window}`, returning any
subset of:

```json
{
  "anomaly": { "score": 0.82, "detected": true },
  "faults":  [ { "id": "misfire", "confidence": 0.71, "cylinder": 2 } ],
  "rul":     { "hours": 118.4, "confidence": 0.81, "limiting": "bearing" },
  "health":  { "overall": 62, "subsystems": { "combustion": 48 } }
}
```

`mergeInference()` keeps every local value the service did not answer, so you can bring one
head online at a time — anomaly first, classification later, RUL last — and the dashboard
never blanks. If the link drops, the twin falls back to its on-board analytics, which is
also the intended edge behaviour on a real airframe.

---

## Deployment roadmap

| Stage | Scope | Status here |
|---|---|---|
| **1 · Software demonstrator** | Physics model, ML stack, HMI, fault library, replay | **complete** |
| **2 · Test-rig integration** | SocketCAN acquisition against a DBC, model parameter identification from real engine runs, dictionary regenerated from the identified model | seam ready (`backend/server.py`) |
| **3 · Data-driven refinement** | Train the anomaly/classification/RUL heads on rig and flight data; the physics model remains the residual generator, so the learned heads work on residuals rather than raw signals and transfer across operating points | seam ready (`/infer`) |
| **4 · Edge deployment** | Twin core on the onboard compute (it is headless and framework-free by design); HMI subscribes from the GCS over the existing link | core is already decoupled from React |
| **5 · Fleet & lifecycle** | Per-airframe wear state persisted and aggregated; federated learning across the fleet without moving raw telemetry off-platform | wear state is already a serialisable vector |
| **6 · Certification support** | Deterministic replay of any recorded mission; every verdict traceable to named residuals and certified limits | replay and evidence chain in place |

### Innovation areas addressed

**Physics-informed AI** — the detector consumes model residuals, not raw signals, and the
fault dictionary is generated by the plant model itself. **Hybrid thermodynamic +
data-driven** — the physics half is fixed and interpretable, the learned half plugs into
`/infer`. **Explainable AI** — every verdict decomposes into named σ contributions and a
physical evidence chain. **Lightweight edge analytics** — the whole twin core is
dependency-free JavaScript running at 20 Hz in a browser tab; it ports to an edge node
unchanged. **Secure telemetry** — the frontend never originates control commands; the seam
is one-way ingest plus a stateless inference POST. **Autonomous maintenance advisory** —
in-flight action, ground action, parts and man-hours, generated from the diagnosis.

### Known limitations

Stated plainly, because a demonstrator that hides them is not useful:

- The engine model is **calibrated to published class data**, not to a specific airframe's
  engine. Stage 2 (parameter identification from rig runs) is what makes it airframe-true.
- Two pairs of physically adjacent faults are separable at top-2 but not reliably at top-1
  (fouling plug vs misfire; fuel contamination vs injector leak). Real transient data would
  separate them on onset rate; the synthetic ramps are too similar.
- The vibration spectrum is a 12-band order-tracked synthesis, not a real FFT of an
  accelerometer stream. Real hardware replaces `vibSpectrum` in the telemetry frame.
- RUL is calibrated so nominal cruise integrates to the published TBO. Absolute hours under
  a fault are order-of-magnitude estimates, which is why the HMI shows a confidence figure
  alongside every one of them.
- The residual **noise floor** (`dictionary.sigma`) is currently measured from the model's
  own healthy scatter. On real hardware it must be re-measured from a healthy-engine
  recording before the σ thresholds mean anything — that is a one-line change in
  `buildDictionary()` (feed it recorded frames instead of simulated ones) and it is the
  single most important calibration step in stage 2.
