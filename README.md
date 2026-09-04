# AeroTwin

**AI-Enabled Real-Time Digital Twin for Health Monitoring, Fault Prediction and Mission Reliability Enhancement of Aero Piston Engines used in MALE UAVs**

Smart India Hackathon · Problem Statement **26054** · DRDO · Department of Defence Production / iDEX
Category: Software · Theme: Robotics and Drones

---

A functional software demonstrator of a Digital Twin for a turbocharged 4-cylinder
horizontally-opposed aero piston engine — 1211 cc, 84 kW, 2.43:1 reduction gearbox driving a
constant-speed propeller. This is the Rotax 912/914 class used in MALE-UAV propulsion.

The system runs a live virtual engine synchronised to telemetry, detects and isolates 23
distinct faults before they reach any certified limit, localises them to the affected cylinder,
estimates remaining useful life, and replays a mission for post-flight analysis. It ships with a
122,040-row labelled fault corpus and a wired seam for live CAN telemetry and a served model.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [The core idea](#2-the-core-idea-two-engines-not-one)
3. [Architecture](#3-architecture)
4. [Repository map](#4-repository-map)
5. [The physics model](#5-the-physics-model)
6. [The fault library](#6-the-fault-library)
7. [Detection, isolation and diagnosis](#7-detection-isolation-and-diagnosis)
8. [Prognostics: wear and RUL](#8-prognostics-wear-and-rul)
9. [The dashboard](#9-the-dashboard)
10. [The dataset](#10-the-dataset-model_data)
11. [Connecting real telemetry and your model](#11-connecting-real-telemetry-and-your-model)
12. [Measured performance](#12-measured-performance)
13. [Requirement traceability](#13-requirement-traceability-ps-26054)
14. [Deployment roadmap](#14-deployment-roadmap)
15. [Known limitations](#15-known-limitations)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

That is everything. No backend, no Python, no data files, no API keys. The twin runs entirely
in the browser on its own physics and analytics — which is also the edge/offline fallback the
real system uses when the GCS link degrades.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload, port 5173 |
| `npm run build` | Static production bundle into `dist/` (~1.1 MB JS, 311 kB gzipped) |
| `npm run preview` | Serve the production build, port 4173 |
| `npm run data` | Regenerate the 122k-row fault corpus into `model_data/` (~63 s) |

`npm run build` produces three static files. Put them on any static host, a USB stick, or a
laptop with no network — the whole demonstrator runs offline.

**First thing to try:** on the Live Monitor, scroll to the *Anomaly Simulation Console* and
press **MISFIRE**. Watch the cylinder go cold in the strip, stop flashing on the 3D model,
and appear as a ranked diagnosis with its evidence. Then press **↺ Restore Baseline**.

**Second thing to try:** press **OP SENSOR**. Oil pressure collapses to a red 0.8 bar — and
the twin tells you it is the transducer, not the pump. That contrast is the point of the
whole project.

---

## 2. The core idea: two engines, not one

The claim that separates a digital twin from a dashboard with thresholds is that it carries a
*model of the machine* and reasons about the difference between the model and reality.

**Every tick, two virtual engines are stepped side by side:**

| | |
|---|---|
| **ACTUAL** | the physics model with injected faults and accumulated wear applied |
| **REFERENCE** | the same model, same accumulated wear, **no fault**, driven by the *same* throttle / altitude / OAT commands |

The difference between what the sensors report and what the reference predicts is the
**residual vector** — 28 physically meaningful channels, each normalised by that channel's
measured healthy noise floor (σ). Everything downstream consumes residuals, not raw signals.

Three consequences fall straight out of this, and they are the entire argument for the design:

**It catches faults far below any threshold.** A 3σ drift in oil pressure is flagged while the
gauge still reads green, because the model says the pressure should not have moved at that RPM
and oil temperature.

**It does not false-alarm on the operator.** Slam the throttle or climb through the
turbocharger's critical altitude and every parameter moves violently — but the reference moves
with them, so the residuals stay flat. A threshold system alarms here. This one does not.

**It separates a broken engine from a broken sensor.** A real oil-pressure loss cannot happen
without the oil heating up and the bearings starting to sing. A failed transducer moves one
channel and nothing else. Those are different *directions* in residual space, and the twin
tells them apart.

### The reference is age-matched, and that detail matters

The reference carries the **same accumulated wear** as the engine under test. It is "this
engine, at this age, with no fault" — not a pristine zero-hour engine.

This was a genuine bug during development. With a pristine reference, residuals measured
*ageing* rather than faults:

| Life used | Healthy \|z\| | Incipient fault \|z\| |
|---|---|---|
| 0 % | 2.6 | 4.4 |
| 15 % | 23.2 | 24.2 |
| 32 % | **49.7** | **50.4** |

A 32 %-worn healthy engine was louder than an incipient fault on a fresh one — normal ageing
would have become a permanent false alarm as flight hours accumulated. With the age-matched
reference the same measurement is flat across the fleet:

| Life used | Healthy \|z\| | Fault sev < 0.15 | Fault sev > 0.85 |
|---|---|---|---|
| 0 % | 2.64 | 4.33 | 71.9 |
| 15 % | 2.75 | 4.29 | 71.0 |
| 32 % | 2.92 | 4.36 | 71.2 |

Ageing is not ignored — it is monitored on its own path, by the health index and the RUL
estimator, which is where it belongs.

---

## 3. Architecture

```
   CAN 2.0B / SocketCAN                  ┌──────────────────────────────────────┐
   ECU / FADEC gateway  ───────────────▶ │      DIGITAL TWIN CORE   (20 Hz)     │
   (or the built-in simulator)           │                                      │
                                         │   ACTUAL engine  ◀── faults + wear   │
                                         │   REFERENCE engine ◀── same wear,    │
                                         │                        no fault      │
                                         │            │                         │
                                         │            ▼                         │
                                         │   residual vector — 28 channels      │
                                         └───────────────┬──────────────────────┘
                                                         │
              ┌──────────────────────────────────────────┼──────────────────────────────┐
              ▼                            ▼             ▼                              ▼
      ANOMALY DETECTION            FAULT ISOLATION   LOCALISATION              PROGNOSTICS
      EWMA (0.6 s / 3 s)           physics-generated  signed per-cylinder      severity-driven
      + CUSUM + robust             fault dictionary,  EGT/CHT deviation        cumulative damage
      Hotelling energy             cosine match       about the bank mean      → per-channel RUL
              │                            │             │                              │
              └──────────────────────────────────────────┴──────────────────────────────┘
                                                         ▼
                    HEALTH INDICES · MAINTENANCE ADVISORIES · 3D TWIN · MISSION RECORDER
                                                         ▼
                             HMI  (12 Hz publish — decoupled from the 20 Hz core)
```

The twin core is **headless and framework-free**. It has no React dependency and no DOM
access; the HMI is just a subscriber. That is deliberate: on a real airframe the core runs on
the onboard edge node and the dashboard runs in the Ground Control Station, and this codebase
is already split along that line.

**Three clocks, decoupled on purpose:** physics at 20 Hz (fixed timestep, deterministic),
HMI publish at 12 Hz (a human reading rate), mission recording at 4 Hz (30 minutes retained).
Frame rate never affects simulation results.

---

## 4. Repository map

```
site/
├── index.html                  13 lines — HTML shell, nothing else lives here
├── package.json                scripts and dependencies
├── vite.config.js
├── .env.example                copy to .env to attach a real backend
│
├── src/                        the application — 4,382 lines
│   ├── main.jsx                entry point: mounts React
│   ├── App.jsx                 tab shell, top bar; calls boot()
│   │
│   ├── sim/                    THE ENGINE
│   │   ├── spec.js             engine specification, certified limits, subsystems, wear channels
│   │   ├── engineModel.js      lumped-parameter thermodynamic + rotational-dynamics model
│   │   ├── faults.js           23 faults as physical modifiers, with damage tables
│   │   ├── wear.js             severity-driven cumulative damage and the RUL estimator
│   │   └── missions.js         4 scripted mission profiles + manual/test-rig mode
│   │
│   ├── ml/                     ANALYTICS  (see §7 — this directory name overstates it)
│   │   ├── features.js         the 28-channel feature vector — the contract for everything
│   │   ├── dictionary.js       self-generated fault signature dictionary
│   │   ├── analytics.js        detection, isolation, localisation, health, trend projection
│   │   ├── advisory.js         maintenance advisory generation
│   │   └── backend.js          the seam for live telemetry and a served model
│   │
│   ├── store/
│   │   ├── twinCore.js         headless twin runtime + mission recorder
│   │   └── useTwin.js          React binding; owns the render loop and the backend link
│   │
│   ├── components/             15 components — gauges, charts, 3D, panels, views
│   └── styles/global.css       the GCS design system
│
├── model_data/                 THE DATASET — 122,040 rows, 121 MB
│   ├── generate.mjs            the generator (deterministic, seeded)
│   ├── train.csv / val.csv / test.csv
│   ├── schema.json             every column described
│   ├── label_map.json          fault metadata
│   ├── operating_points.csv    the 60 conditions and their split assignment
│   ├── sigma.json              per-channel residual noise floor
│   ├── limits.json             certified limits
│   ├── stats.json              row counts and class balance
│   └── README.md               dataset documentation — read before training on it
│
└── backend/                    REFERENCE BACKEND (optional)
    ├── server.py               FastAPI: WebSocket telemetry + REST inference
    └── requirements.txt
```

**Where to edit what:**

| To change | Go to |
|---|---|
| How the engine behaves physically | `src/sim/engineModel.js` |
| Add or retune a fault | `src/sim/faults.js` |
| Limits, nominal values, subsystems | `src/sim/spec.js` |
| Detection sensitivity or diagnosis logic | `src/ml/analytics.js` |
| The 3D model | `src/components/Engine3D.jsx` |
| Main screen layout | `src/components/MonitorView.jsx` |
| Colours, spacing, typography | `src/styles/global.css` |
| Your telemetry / your model | `backend/server.py` and `.env` |

You will essentially never touch `index.html`.

---

## 5. The physics model

`src/sim/engineModel.js` — a lumped-parameter model stepped at 20 Hz with a fixed timestep and
first-order lags on every thermal and mechanical state. It is deterministic given
(inputs, fault modifiers, wear).

### What is modelled

**Induction and turbocharging.** Compressor pressure-ratio limit and wastegate schedule, so
boost holds to the ~4900 m critical altitude and falls away above it exactly as the real engine
does. Manifold pressure lags with a 0.35 s time constant; turbo speed with 0.8 s.

**Air and fuel.** Volumetric efficiency as a function of RPM (peaking near 4800), manifold
charge density from MAP and post-intercooler temperature, an ECU lambda schedule that enriches
for cooling at power, per-cylinder injector flow trim, and delivery capped by pump head. The
injector pulse width the ECU commands is computed, not assumed.

**Combustion.** Efficiency as an *asymmetric* function of lambda — an engine tolerates
lean-of-peak further than it tolerates flooding, so the lean arm of the curve is wider.
Ignition-timing efficiency about the scheduled map, per-cylinder combustion quality, trapped
compression, and a knock penalty.

**Rotational dynamics.** A real constant-speed propeller governor: blade pitch is integrated to
hold commanded RPM against a cube-law prop load, with proportional damping to stop it hunting.
When pitch saturates at fine and the engine still cannot make power, **RPM droops** — which is
precisely how a real engine reveals a power loss, and why a misfire here shows up as a torque
and EGT signature rather than as an RPM collapse.

**Thermal.** Thermostat-regulated coolant with a rejection-capacity knee (temperature is held
flat until cooling capacity runs out, then runs away — that knee *is* the overheat trend);
per-cylinder CHT from an explicit heat-in / heat-out balance against the coolant; oil
temperature downstream of coolant, bearing load and gearbox load.

**Lubrication.** Oil pressure as pump curve × temperature-dependent viscosity × clearance. This
is why a cold engine shows high oil pressure and why viscosity breakdown only reveals itself
when hot.

**Vibration.** An order-tracked synthetic spectrum across 12 bands, with energy placed at
mechanically meaningful frequencies: ½-order (misfire), prop 1P (imbalance), first engine order,
firing order, gear mesh at 39× prop, and a high-frequency knock band. Bands are labelled by
mechanism in the HMI, not by index.

**Electrical.** Alternator capability against RPM, bus load, and battery state-of-charge with a
real 10 Ah capacity — so an alternator failure produces a genuine endurance countdown rather
than a warning light.

**Sensor layer.** Everything downstream of `sense()` sees only what a real ECU would put on the
CAN bus: quantisation noise, bias, drift and channel dropout. Where a channel goes invalid the
twin substitutes its own model estimate and says so on the HMI.

### Verified operating points

All produced by `stepEngine` from first principles — there are no lookup tables:

| Condition | RPM | MAP | CHT | EGT | Oil P | Oil T | Coolant | Fuel | Power | Vib |
|---|---|---|---|---|---|---|---|---|---|---|
| Cruise, 3000 m | 4897 | 30.0 | 106 °C | 774 °C | 3.44 bar | 99 °C | 79 °C | 18.8 L/h | 50 kW | 1.47 g |
| Sea level | 4900 | 30.9 | 113 °C | 779 °C | 3.12 bar | 105 °C | 85 °C | 19.2 L/h | 50 kW | 1.49 g |
| 7000 m, above crit alt | 4903 | 22.5 | 91 °C | 714 °C | 4.17 bar | 87 °C | 69 °C | 15.2 L/h | 40 kW | 1.48 g |
| Hot & slow, ISA +25 | 4887 | 30.6 | 116 °C | 752 °C | 2.87 bar | 110 °C | 89 °C | 17.6 L/h | 46 kW | 1.49 g |
| Full throttle | 5695 | 40.5 | 141 °C | 835 °C | 2.76 bar | 122 °C | 97 °C | 29.0 L/h | 66 kW | 1.67 g |
| Loiter, 35 % | 3740 | 17.0 | 86 °C | 639 °C | 3.29 bar | 86 °C | 73 °C | 7.9 L/h | 21 kW | 0.81 g |

Read the third row against the first: at 7000 m the turbo has run out of pressure ratio, MAP has
fallen from 30.0 to 22.5 inHg and power from 50 to 40 kW, while oil pressure has *risen* because
the oil is 12 °C cooler and therefore thicker. Nothing in that behaviour was scripted; it falls
out of the model.

### Mission profiles

`src/sim/missions.js` — four profiles, each chosen because it stresses a different failure mode:

- **ISR Endurance Orbit** — 18 h maritime pattern. Long low-power loiter, the condition the
  engine actually spends its life in.
- **High-Altitude Ingress** — climb through the turbocharger critical altitude. Boost falls
  away, EGT rises, cooling airflow thins.
- **Hot-and-High Operation** — ISA +30 desert departure at low airspeed. Cooling margin at its
  thinnest; CHT and oil temperature lead the story.
- **Rapid Throttle Transients** — repeated slam accelerations and chops. Governor response,
  thermal shock, knock margin.
- **Manual / Test Rig** — throttle, altitude, ISA deviation and airspeed driven directly. Use
  this to fly the twin against a test-cell condition.

---

## 6. The fault library

`src/sim/faults.js` — 23 faults covering every category the problem statement asks for and
several it implies. Each is injected as a **physical modifier** into the model (combustion
efficiency, injector flow trim, pump head, cooling capacity, bearing clearance, sensor bias)
and **ramps in over its own realistic time constant**. The detector is never told which button
was pressed; it sees only the resulting sensor stream, exactly as it would on the CAN bus.

| Category | Fault | Onset | Per-cyl |
|---|---|---|---|
| **Combustion & ignition** | Cylinder Misfire | 12 s | ● |
| | Spark Plug Fouling | 45 s | ● |
| | Detonation / Combustion Instability | 20 s | |
| | Ignition Timing Drift | 35 s | |
| | Exhaust Valve Leakage / Compression Loss | 60 s | ● |
| **Fuel & injection** | Injector Clogging | 40 s | ● |
| | Injector Stuck Open / Leaking | 25 s | ● |
| | Fuel Pump Degradation / Starvation | 30 s | |
| | Fuel Contamination / Water Ingress | 22 s | |
| **Lubrication & cooling** | Oil Pressure Loss | 18 s | |
| | Oil Degradation / Viscosity Breakdown | 70 s | |
| | Coolant Loss / Cooling Degradation | 40 s | |
| | Radiator / Oil Cooler Duct Blockage | 50 s | |
| **Mechanical & rotating** | Main / Rod Bearing Wear | 65 s | |
| | Propeller Imbalance / Blade Damage | 8 s | |
| | Reduction Gearbox Wear | 70 s | |
| **Induction & turbo** | Turbocharger / Wastegate Fault | 25 s | |
| | Induction Leak / Filter Clogging | 45 s | |
| **Electrical** | Alternator Failure / Battery Discharge | 15 s | |
| | Voltage Regulator Fault / Overcharge | 20 s | |
| **Sensor integrity** | CHT/EGT Sensor Drift | 55 s | ● |
| | Sensor Dropout / Open Circuit | 3 s | ● |
| | Oil Pressure Transducer Fault | 6 s | |

Progressive onset is not cosmetic. A fault that switches on instantaneously is trivial to
detect — you are just watching for a step. Ramping over the fault's own physical time constant
means the detector has to earn the detection during the *incipient* stage, which is the stage
that has any operational value.

### Three of these are instrumentation faults, deliberately

`sensor_drift`, `sensor_dropout` and `oilpress_sensor` are in the library because **suppressing
false alarms is worth more to a MALE-UAV operator than raw detection sensitivity**. An aborted
18-hour ISR sortie because a $40 transducer drifted is a mission-effectiveness failure.

Press **OP SENSOR** and watch: indicated oil pressure collapses to 0.8 bar. A threshold system
declares an engine emergency. The twin isolates it to the transducer at 99 % confidence, because
oil *temperature* is normal, and a real oil-pressure loss cannot happen without the oil heating
up, and there is no bearing vibration signature. The residual direction for a sensor fault is a
single isolated channel; for a real pump failure it is a coupled cluster.

---

## 7. Detection, isolation and diagnosis

### Is any of this machine learning? No — and here is exactly what it is instead.

**There is no trained model in this repository.** No weights, no fitted parameters, no neural
network, and nothing was learned from data. `grep` for it and you will find nothing. The
directory is named `src/ml/` and an earlier version of this document called it an "AI/ML layer"
— that took the problem statement's vocabulary and applied it to code that does not earn it.
Stated plainly, what runs is five classical statistical techniques, all of them older than
machine learning:

| Function | Technique | Origin |
|---|---|---|
| Residual smoothing | EWMA, dual time constant (0.6 s fast / 3 s slow) | Roberts, 1959 |
| Slow-drift detection | One-sided CUSUM, fast-draining | Page, 1954 |
| Anomaly score | Robustified Hotelling-style T² energy | Hotelling, 1947 |
| Fault classification | Cosine similarity against 23 template vectors | nearest-centroid |
| Trend / time-to-limit | Ordinary least squares over a 90 s window | Gauss |

Plus the physics model, and standard deviation for normalisation.

The one honest caveat in the other direction: cosine matching against class templates *is* a
nearest-centroid classifier, which is a real if elementary ML algorithm. But the centroids are
computed from the physics model, not learned from data.

**Why this is nonetheless the right tool.** Model-based fault detection and isolation with
structured residuals is a decades-old discipline that exists *precisely because* labelled
failure data for aero engines barely exists — nobody deliberately destroys engines to collect
it, and PS 26054 asks you to predict failures "before occurrence", which by definition means you
have few examples of them. The public prognostics datasets are all adjacent, not on point:
NASA C-MAPSS is turbofan (and itself simulated); CWRU, NASA IMS and FEMTO PRONOSTIA are
bearing-vibration rigs. None are aero piston engines. A plant model is the honest starting
point.

**The path to a genuine learned component is now open.** `model_data/` (§10) contains 122,040
labelled rows generated from this physics model. Training an anomaly head and a classifier on
that corpus — *on the residual columns, not the raw signals* — would produce real weights, a
real train/test split, and a real held-out generalisation number. See §11 for where they plug
in. Nothing else in the system needs to change.

### How the pieces work

**Residual generation.** `analytics.js` differences the 28-channel feature vector of the sensed
engine against the reference twin and divides by σ. σ itself is measured, not guessed: the
dictionary builder runs the healthy model at three operating points and takes the per-channel
standard deviation, with a floor to stop a quiet channel producing infinite z-scores.

**Anomaly statistic.** The z-vector is smoothed by two EWMAs — a fast one (0.6 s) for step
response and a slow one (3 s) for a stable direction estimate. The score is a robustified
Hotelling energy: only the part of each residual beyond 2.5σ counts, so noise across 28 channels
never accumulates into a false positive. A one-sided CUSUM runs in parallel to catch slow drifts
that never produce a large instantaneous residual. Detection is latched with hysteresis and
gated on total residual magnitude, so the classifier never names a best match for pure noise.

**The fault dictionary is generated by the physics model, not hand-labelled.** At boot the twin
runs ~70 short simulations: three representative operating points healthy (to measure the noise
floor) and each of the 23 faults at full severity across those same points. The normalised
difference is that fault's unit direction in residual space. This takes about 640 ms and is what
the boot screen is doing. It is the classical structured-residual FDI formulation, built
automatically from the plant model rather than from a labelled dataset nobody has.

**Classification** is a cosine match between the live residual direction and the dictionary,
plus a plausibility constraint — no fault can produce a residual louder than its own
full-severity signature — softmaxed into ranked hypotheses.

**Localisation** uses the *signed* per-cylinder EGT and CHT deviation about the bank mean,
oriented by the matched fault's own thermal sign. The signedness is essential: a sign-blind
spread cannot tell a cylinder running hot (valve leak) from one running cold (flooded injector),
which are opposite faults with identical spreads.

**Explainability.** Every verdict decomposes into named feature contributions with their σ
values and the fault's physical evidence chain. There is no unexplained number anywhere in the
HMI — a maintenance engineer will not action a black-box verdict, and should not be asked to.

---

## 8. Prognostics: wear and RUL

`src/sim/wear.js` — twelve wear channels (piston/rings, valvetrain, injectors, fuel pump,
plugs/coils, bearings, gearbox, oil system, cooling system, turbo, alternator, sensors), each a
scalar from 0 (new) to 1 (life expended).

**Wear accrues from operating severity, not clock time.** CHT above 110 °C, oil temperature
above 115 °C, knock above 0.30, lean excursions, oil pressure below 2.2 bar and vibration above
2.2 g each multiply the damage rate on the channels they physically attack. An hour of hot,
knocking, oil-starved running consumes far more life than an hour of benign loiter — which is
how real engines actually wear out.

RUL for each channel is `(1 − accumulated damage) ÷ current damage rate`, and the engine's RUL
is the minimum across channels. Confidence falls as the current rate diverges from the nominal
rate the baseline life was scheduled against, because a long extrapolation off a violent
transient is a less trustworthy prediction than a long steady one.

**The calibration is that nominal cruise integrates to the published TBO.** That is not a
coincidence — it is the anchor:

| Condition | Limiting channel | RUL |
|---|---|---|
| Nominal cruise | Plugs / coils | **1223 h** ≈ 1200 h TBO |
| Sustained detonation | Piston / ring pack | **27 h** |
| Coolant loss | Radiator / coolant | **11 h** |
| Oil pressure loss | Main & rod bearings | **10 h** |

There are two separate time horizons in the HMI and they answer different questions.
**Time-to-limit** (minutes) is a least-squares projection of a live parameter toward its
certified limit — "CHT reaches 135 °C in 4.2 minutes, reduce power now". **RUL** (hours) is the
cumulative-damage horizon — "the bearings have 10 hours left at this severity". Conflating them
is a common error; an engine can have hours of RUL and 90 seconds to a limit.

The *Life-accrual scale* control compresses degradation so RUL moves inside a five-minute demo.
It is labelled on the HMI and ×1 is real time.

---

## 9. The dashboard

Four views, dark-first for a low-light Ground Control Station.

**Live Monitor** — instrument cluster with caution and exceedance arcs drawn from the real
certified limits; the animated 3D virtual engine; cylinder-level EGT/CHT with the diagnosed
cylinder flagged; the order-tracked vibration spectrum; the anomaly verdict with ranked
hypotheses and σ-level evidence; health indices and RUL; mission and environment controls; and
the 23-button anomaly simulation console.

**Diagnostics** — the full 28-channel residual table (observed / model / residual / z / CUSUM,
sorted by |z|), time-to-limit projections with slopes, and 12 trend charts with caution and
limit reference lines and hover crosshairs.

**Simulation & Replay** — scrub the 4 Hz mission recording frame by frame with the full
instrument panel, a marked mission trace, and a mission health report: peak CHT/EGT/oil
temperature, minimum oil pressure, peak vibration, lowest health index, RUL consumed, and every
diagnosed event with its time window. Click an event to jump to it.

**Maintenance** — advisories with in-flight action, ground action, part and man-hours, ranked
with the root-cause diagnosis pinned first; the life-limited item schedule with damage rates
relative to nominal; and deployment/integration status.

### The 3D twin

`src/components/Engine3D.jsx` — built procedurally from the engine specification, so it cannot
drift out of sync with the model: crankcase, four opposed finned cylinders with heads and rocker
covers, injectors and plugs, intake plenum, exhaust stubs, turbocharger with a spinning turbine,
reduction gearbox, three-blade propeller, oil pan and pump, radiator core, alternator and ECU.

It is driven by live state, not decoration:

- Cylinder surfaces are **coloured by their own CHT**; exhaust stubs glow with EGT.
- Each cylinder **flashes on its firing event**, timed on the real firing order at the true
  firing frequency — so a **misfiring cylinder visibly stops firing**.
- The propeller turns at prop RPM; the turbine at turbo speed.
- The diagnosed component **pulses with a halo** and the flagged cylinder turns red.
- Orbit, zoom, click a cylinder to select it.

---

## 10. The dataset (`model_data/`)

A labelled, split, ML-ready corpus generated from the physics model. **Data only — no model is
trained here and no weights are shipped.**

```bash
npm run data                            # regenerate (~63 s, deterministic, seed 20260904)
node model_data/generate.mjs --smoke    # ~4k rows, for checking the shape
```

| | |
|---|---|
| Rows | **122,040** (train 85,428 / val 18,306 / test 18,306) |
| Columns | 134 |
| Size | 121 MB |
| Operating points | 60 — 5 altitudes (0–7200 m) × 4 throttle × 3 ISA deviations |
| OAT range | −41.8 °C to +43.0 °C |
| Fleet age | 3 wear levels (0 %, 15 %, 32 % of life used) |
| Fault configs | 44 — 16 engine-wide + 7 per-cylinder × 4 cylinders |
| Severity | continuous 0.04 → 1.00, sampled **down each fault's ramp** |
| Healthy | 27,000 rows (22.1 %) |

Column groups: `s_` sensed CAN channels (47, with noise/bias/dropout), `f_` features (28),
`z_` physics residuals (28), `w_` wear state (12), plus identity, flight condition and targets
for all four tasks — 24-class label, binary anomaly, cylinder, severity, and `rul_hours`.

**Sampling down the ramp is the point.** Most of the corpus is *incipient* fault. A model
trained only on full-severity faults learns to recognise an engine that has already broken.

**Split by operating point, not by row.** Test rows come from altitude/throttle/temperature
combinations that appear nowhere in training — zero `op_id` and zero `run_id` overlap, verified.
Rows from the same `run_id` are highly correlated; splitting on rows would put neighbours on
both sides and inflate any score.

**Two traps documented in `model_data/README.md`:** `sensor_dropout` is statistically invisible
in residual space by construction and detectable *only* through the `s_*_valid` flags; and rows
at `severity=0.04` are labelled with a fault but are close to indistinguishable from healthy, and
should be.

Read `model_data/README.md` before training on it.

---

## 11. Connecting real telemetry and your model

`src/ml/backend.js` is the only file that needs to know a backend exists, and it is **wired in
and tested**, not a stub.

```bash
cp .env.example .env                    # 1. must be .env, not .env.example
python3 backend/server.py               # 2. terminal A — serves :8765
npm run dev                             # 3. terminal B — RESTART it; vite bakes env at startup
```

**Direction matters.** Your Python script is the *server*; the browser is the *client*. A
browser page cannot listen on a port — it dials out. Python holds the socket open and pushes
frames down it.

```
backend/server.py  ──ws://localhost:8765/telemetry──▶  src/ml/backend.js  createTelemetryLink()
                                                              ▼
                                              src/store/useTwin.js   onFrame
                                                              ▼
                                              src/store/twinCore.js  ingestTelemetry()
```

**Telemetry contract** — one JSON frame per tick. Edit `read_engine_frame()` in
`backend/server.py` (commented examples for SocketCAN and cantools DBC decoding are in place).
Any channel you omit falls back to the twin's model estimate, so a partial DBC works from day one.

**Inference contract** — `POST /infer` with `{features, residuals, window}`, returning any subset of:

```json
{
  "anomaly": { "score": 0.82, "detected": true },
  "faults":  [ { "id": "misfire", "confidence": 0.71, "cylinder": 2 } ],
  "rul":     { "hours": 118.4, "confidence": 0.81, "limiting": "bearing" },
  "health":  { "overall": 62, "subsystems": { "combustion": 48 } }
}
```

`mergeInference()` keeps every local value the service did not answer, so you can bring one head
online at a time — anomaly first, classification later, RUL last — and the dashboard never
blanks. If frames stop for 2 s the twin reverts to its own physics, which is the intended edge
behaviour on a real airframe.

Verified end to end: healthy live frames stay nominal; a dead-cylinder frame stream is detected
and localised to the correct cylinder; link drop falls back cleanly; partial frames do not
corrupt state.

**Known gap:** once live telemetry is driving, the 23 fault buttons have no effect — the actual
engine state comes from your frames, so injected modifiers apply to nothing. The buttons still
light up, which is misleading. They should be disabled in live mode with a visible note. Not yet
fixed.

---

## 12. Measured performance

Reproduce with the shipped `TwinCore` — 25 s healthy, then each fault ramped to full severity
and held:

| Metric | Result |
|---|---|
| False alarms on a healthy engine | **0 / 23** |
| Top-1 isolation accuracy | **20 / 23** |
| Top-2 isolation accuracy | **23 / 23** |
| Cylinder localisation on per-cylinder faults | correct in every case |
| Fault dictionary build time | ~640 ms (~70 simulations) |

The three top-1 confusions are all between physically adjacent faults, and in every case the
true fault ranks second:

| Injected | Top-1 | Why they overlap |
|---|---|---|
| Spark plug fouling | Misfire | A fouling plug *is* an incipient misfire |
| Fuel contamination | Injector leak | Both present as erratic, rich, cold combustion |
| Gearbox wear | Oil degradation | Both raise oil temperature with rising broadband vibration |

The HMI shows ranked hypotheses rather than a single hard call. Reporting
`MISFIRE 67 % / PLUG FOULING 22 %` tells a maintenance engineer to pull the plug first;
inventing certainty would not.

### Read this before quoting the number

**This is a self-consistency check, not a generalisation result.** The fault dictionary was
generated by this simulator and then tested by injecting faults into that same simulator. Train
and test come from one generative model.

It demonstrates something real — that the 23 residual directions are mathematically separable,
that the detector does not false-alarm on its own noise, and that the confusable pairs are
confusable for physically legitimate reasons. It is **not** evidence that the system works on a
physical engine, and quoting the accuracy without this paragraph attached would be misleading.

The dataset in §10 exists partly to fix this: its test split holds out whole operating
conditions, so a model trained on it can be given a genuine held-out score. Even that remains a
score against synthetic physics until rig data arrives.

---

## 13. Requirement traceability (PS 26054)

| Requirement | Where | Status |
|---|---|---|
| **A. Digital Twin core framework** | | |
| Virtual engine model synchronised with live engine data | `sim/engineModel.js`, `store/twinCore.js` | ✔ 20 Hz, dual-twin |
| Modular architecture for future scalability | headless core, no framework dependency | ✔ |
| Real-time data ingestion | `ml/backend.js`, `twinCore.ingestTelemetry()` | ✔ wired, tested |
| **B. Health monitoring** | | |
| RPM, CHT, EGT, oil P&T, fuel flow, vibration, battery/alternator, injection timing | all modelled per cylinder where applicable | ✔ |
| Health indices for predictive maintenance | 9 subsystem indices + engine index | ✔ |
| **C. Fault detection & predictive analytics** | | |
| Misfire, injector abnormalities, cooling degradation, lubrication, sensor drift/failure, combustion instability, overheating trends, abnormal vibration | 23-fault library, all 8 named cases covered | ✔ |
| **D. AI/ML layer** | | |
| Anomaly detection algorithms | model-based residuals + EWMA/CUSUM/Hotelling | ⚠ statistical, **not** ML — see §7 |
| RUL estimation | severity-driven cumulative damage | ✔ |
| Trend analysis | least-squares time-to-limit | ✔ |
| Predictive maintenance recommendations | `ml/advisory.js` | ✔ |
| **E. Simulation & replay** | | |
| Replay of historical mission data | 4 Hz recorder + scrubber | ✔ |
| Environmental condition simulation | altitude, ISA deviation, airspeed | ✔ |
| High altitude / endurance / hot weather / rapid transients | 4 scripted mission profiles | ✔ |
| **F. Visualization dashboard** | | |
| Real-time health status, fault alerts, efficiency trends, maintenance advisory, mission-wise health reports | 4 views | ✔ |

**Row D is the one to be straight about.** The anomaly detection is statistically rigorous and
well-suited to the problem, but it is not machine learning, and §7 explains both why that is a
defensible engineering choice and exactly what it would take to add a genuine learned component.
A judge who reads the code will ask; the answer should be ready rather than improvised.

### Innovation areas addressed

**Physics-informed AI** — the detector consumes model residuals, not raw signals, and the fault
dictionary is generated by the plant model itself. **Hybrid thermodynamic + data-driven** — the
physics half is fixed and interpretable; the learned half plugs into `/infer`. **Explainable
AI** — every verdict decomposes into named σ contributions and a physical evidence chain.
**Lightweight edge analytics** — the twin core is dependency-free JavaScript running at 20 Hz in
a browser tab; it ports to an edge node unchanged. **Secure telemetry** — the frontend never
originates control commands; the seam is one-way ingest plus a stateless inference POST.
**Autonomous maintenance advisory** — in-flight action, ground action, parts and man-hours,
generated from the diagnosis.

---

## 14. Deployment roadmap

| Stage | Scope | Status |
|---|---|---|
| **1 · Software demonstrator** | Physics model, analytics, HMI, fault library, replay, dataset | **complete** |
| **2 · Test-rig integration** | SocketCAN acquisition against a DBC; **re-measure `sigma.json` from a healthy-engine recording**; re-identify physics parameters from real runs; regenerate the dictionary from the identified model | seam ready (`backend/server.py`) |
| **3 · Data-driven refinement** | Train anomaly / classification / RUL heads. Train on **residuals**, not raw signals — the physics model stays the residual generator, so learned heads transfer across operating points | seam ready (`/infer`), corpus ready (`model_data/`) |
| **4 · Edge deployment** | Twin core on the onboard compute; HMI subscribes from the GCS over the existing link | core already decoupled |
| **5 · Fleet & lifecycle** | Per-airframe wear state persisted and aggregated; federated learning across the fleet without moving raw telemetry off-platform | wear state is already a serialisable vector |
| **6 · Certification support** | Deterministic replay of any recorded mission; every verdict traceable to named residuals and certified limits | replay and evidence chain in place |

**Stage 2's σ recalibration is the single highest-value use of rig time.** Right now the σ
thresholds are relative to the simulator's own scatter, so on real hardware they mean nothing.
Feeding recorded healthy frames into `buildDictionary()` instead of simulated ones is a small
change with a large effect, and it must happen before any accuracy figure means anything.

---

## 15. Known limitations

Stated plainly, because a demonstrator that hides them is not useful.

1. **No real engine data anywhere.** The physics model is calibrated against *published
   specification values* for a Rotax 912/914-class engine, not against a physical airframe.
   Stage 2 parameter identification is what makes it airframe-true.

2. **The residual noise floor is synthetic.** `sigma.json` is measured from the model's own
   healthy scatter. It must be re-measured from a healthy-engine recording before the σ
   thresholds mean anything on hardware.

3. **The 20/23 accuracy figure is self-consistency, not generalisation.** See §12.

4. **No machine learning.** See §7. The `src/ml/` directory name is inherited from the problem
   statement's vocabulary and overstates what is in it.

5. **Three fault pairs are separable at top-2 but not reliably at top-1** (fouling plug vs
   misfire; fuel contamination vs injector leak; gearbox wear vs oil degradation). Real
   transient data would separate them on onset rate; the synthetic ramps are too similar.

6. **The vibration spectrum is a 12-band order-tracked synthesis**, not a real FFT of an
   accelerometer stream. Real hardware replaces `vibSpectrum` in the telemetry frame.

7. **RUL hours under a fault are order-of-magnitude estimates.** The calibration anchor is that
   nominal cruise integrates to the published TBO; absolute figures under fault conditions are
   not validated, which is why the HMI shows a confidence figure beside every one.

8. **Fault injection is silently inert in live-telemetry mode.** See §11.

9. **Compound faults report only the loudest.** Inject two at once and the classifier names the
   dominant one, with the second usually appearing in the ranked hypotheses. There is no
   multi-fault decomposition.

---

## 16. Troubleshooting

**The boot screen sits on "Generating fault signature dictionary".** Normal for ~640 ms. If it
persists, check the browser console — a physics-model exception during dictionary generation
will hang it there.

**The 3D stage is blank.** Almost always a lost WebGL context (tab suspend, driver reset, hot
reload). The canvas remounts itself automatically after 200 ms; a page refresh always fixes it.
Check the console for `THREE.WebGLRenderer: Context Lost`.

**Everything reads zero / the mission clock is frozen.** The physics loop is not stepping. This
was a real bug (a 60 Hz frame is 16.7 ms against a 50 ms physics step, and rounding per frame
discarded the remainder). It is fixed with a fixed-timestep accumulator in `TwinCore.step()`;
if you modify that loop, preserve the accumulator.

**The link pill says `EDGE · LOCAL MODEL` after starting `server.py`.** You have no `.env`
(copy it from `.env.example`), or you did not restart `npm run dev` after creating it — Vite
bakes environment variables in at startup.

**The link pill says `LINK UP · NO FRAMES`.** The WebSocket connected but frames are not parsing
as JSON. Check `read_engine_frame()` returns a plain dict with finite numbers.

**The fault buttons light up but nothing happens.** You are in live-telemetry mode. See §11.

**A fault stays diagnosed after Restore Baseline.** Give it ~60 s. Thermal states have real time
constants and the CUSUM has to drain; the residual tail after clearing a misfire is physically
real, not a stuck detector.

---

## Licence and provenance

Built as a demonstrator for SIH PS 26054. The engine specification is modelled on publicly
published data for the Rotax 912/914 family; no proprietary engine data was used, and no real
flight or test-cell data is included in this repository.
