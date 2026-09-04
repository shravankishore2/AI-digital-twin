# `model_data/` — AeroTwin fault & degradation corpus

Labelled, split, ML-ready data covering the full operating envelope of the
AP-4T aero piston engine, every fault in the library across its full severity
ramp, and three fleet-age levels.

**Generated data only. No model is trained here and no weights are shipped.**

Regenerate at any time (fully deterministic, seed `20260904`):

```bash
node model_data/generate.mjs           # full corpus
node model_data/generate.mjs --smoke   # ~4k rows, for checking the shape
```

## Files

| File | What it is |
|---|---|
| `train.csv` / `val.csv` / `test.csv` | The corpus, split by operating point (see below) |
| `schema.json` | Every column: order, group, and a one-line description |
| `label_map.json` | `label_idx` → fault id, human label, category, per-cylinder flag, physical description and evidence chain |
| `operating_points.csv` | The 60 operating points and their split assignment |
| `sigma.json` | Per-channel residual noise floor used to compute the `z_*` columns |
| `limits.json` | Certified caution/exceedance limits for every parameter |
| `stats.json` | Row counts, class balance, generation time |

## How it was generated

Every row comes from the physics model in `src/sim/engineModel.js` — a
lumped-parameter thermodynamic and rotational-dynamics model of the engine.
For each of 60 operating points and 3 wear levels:

1. A healthy engine is settled for 170 s at that condition and wear level.
2. That settled state is **cloned** for every fault run, so the only difference
   between a healthy row and a faulted row is the fault itself.
3. The fault is ramped in over its own realistic time constant and sampled at
   ten points **down the ramp**, plus twice after it completes.

Sampling down the ramp is the important part: most of the corpus is *incipient*
fault, not full-blown failure. A model trained only on faults at full severity
learns to recognise an engine that has already broken, which is not the problem
worth solving.

| Dimension | Values |
|---|---|
| Altitude | 0, 1800, 3600, 5400, 7200 m |
| Throttle | 0.30, 0.50, 0.72, 0.95 |
| ISA deviation | −10, 0, +28 °C |
| Airspeed | derived from throttle, with a per-point offset (drives cooling flow) |
| Wear level | 0 %, 15 %, 32 % of component life consumed |
| Fault configs | 16 engine-wide + 7 per-cylinder × 4 cylinders = 44 |
| Severity | continuous, 0.04 → 1.00 |

## Column groups

| Prefix | Count | Meaning |
|---|---|---|
| *(none)* | 15 | identity, flight condition, and labels |
| `s_` | 47 | **Sensed channels** — what the CAN bus reports, with sensor noise, bias and dropout applied. This is the honest input: what you would actually receive from an ECU/FADEC. |
| `f_` | 28 | **Feature vector** — the derived features (means, signed per-cylinder deviations, vibration band energies, roughness). |
| `z_` | 28 | **Residual z-scores** — `(observed − healthy-model prediction) / sigma`. The physics-informed feature. |
| `w_` | 12 | **Wear state** — accumulated damage per component, 0–1. Known in practice from maintenance records. |

Targets: `label` / `label_idx` (24-class), `anomaly` (binary), `cylinder`
(4-class, `-1` where not applicable), `severity` (regression, 0–1),
`rul_hours` + `rul_limiting` + `life_used_pct` (prognostics).

The healthy-model prediction is recoverable without a separate column:
`r_x = f_x − z_x × sigma[x]`, with `sigma` in `sigma.json`.

### The reference is age-matched, and this matters

The "healthy-model prediction" the `z_` columns are taken against is **the same
engine at the same accumulated wear, minus the fault** — not a pristine
zero-hour engine. Residuals therefore isolate *faults*; ageing is carried
separately in the `w_*` columns and in `rul_hours`.

Getting this wrong is not a small error. An earlier build of this corpus used a
pristine reference, and the result was:

| wear level | healthy \|z\| | incipient fault \|z\| |
|---|---|---|
| 0 % | 2.6 | 4.4 |
| 15 % | 23.2 | 24.2 |
| 32 % | 49.7 | 50.4 |

A 32 %-worn healthy engine was *louder* than an incipient fault on a fresh one,
so the anomaly label carried almost no information above about 15 % life used.
With the age-matched reference the same measurement is flat:

| wear level | healthy \|z\| | fault sev < 0.15 | fault sev > 0.85 |
|---|---|---|---|
| 0 % | 2.64 | 4.33 | 71.9 |
| 15 % | 2.75 | 4.29 | 71.0 |
| 32 % | 2.92 | 4.36 | 71.2 |

Fleet age no longer drives the residual at all. (The same correction was applied
to the live twin in `src/store/twinCore.js` — a pristine reference would have
turned normal ageing into a permanent false alarm as flight hours accumulated.)

### Two columns that are easy to miss

- **`s_cht{n}_valid` / `s_egt{n}_valid`** — `0` when that channel has dropped
  out, and the matching `s_cht{n}` / `s_egt{n}` cell is **empty**. The
  `sensor_dropout` class is *only* detectable from these flags: its residuals
  are near zero by construction, because a missing channel produces no residual.
  Any model that ignores the validity flags will score ~0 on that class, and
  that is correct behaviour, not a bug in the data.
- **`severity`** — a row at `severity=0.04` is a fault that has barely started.
  It is labelled with the fault, but it is close to indistinguishable from
  healthy, and it *should* be. Consider training with a severity-weighted loss,
  or reporting accuracy bucketed by severity, rather than treating all faulted
  rows as equally learnable.

## Split policy — read this before reporting a number

`train` / `val` / `test` are split **by operating point, not by row**
(70 / 15 / 15 over the 60 points, seeded shuffle).

Test rows therefore come from altitude / throttle / temperature combinations
that appear nowhere in training. A model scored on `test.csv` is being asked to
generalise across the operating envelope, which is the thing that actually
matters — the engine will not spend its life at the conditions you trained on.

Rows from the same `run_id` are highly correlated (consecutive samples of one
continuous simulation). **Never split on rows** — you would put neighbouring
samples of the same run on both sides and score far higher than the model
deserves. The split here already prevents that; if you re-split, group by
`op_id` or at minimum by `run_id`.

Every fault class appears in all three splits. The *conditions* are held out,
not the classes.

## Measured class separation (test split, full severity)

Mean residual magnitude per class against a healthy baseline of **2.8**:

```
sensor_dropout      2.7   ← see below
valve_leak         22.9      oil_degradation     66.3
gearbox_wear       26.0      detonation          71.9
prop_imbalance     39.4      induction_leak      77.9
sensor_drift       45.2      oil_pressure_loss   85.4
fuel_contam        50.7      turbo_wastegate     87.2
plug_fouling       50.9      ignition_timing     88.2
injector_leak      62.8      radiator_block      90.2
bearing_wear       63.8      alternator_fail     90.7
injector_clog      64.4      misfire            100.7
oilpress_sensor    65.1      coolant_loss       119.1
                             fuel_pump          179.0
                             regulator_fault    582.7
```

`sensor_dropout` sits at 2.7 — indistinguishable from healthy in residual space,
which is correct and by construction. It is detectable **only** through the
`s_*_valid` flags. This is the concrete case the warning above is about.

A caution on reading this table: large separation is not the same as easy
classification. `misfire` (100.7) and `plug_fouling` (50.9) point in nearly the
same direction in residual space and are the hardest pair in the corpus to tell
apart, despite both being loud.

## What this data is and is not

**Is:** a complete, physically consistent, fully labelled sweep of failure modes
that no real fleet would ever hand you, because collecting it would mean
deliberately destroying engines. Coverage of the incipient stage is the point.

**Is not:** real engine data. Every row came from a model calibrated against
*published specification values* for a Rotax 912/914-class engine, not against a
physical airframe. A model trained on this corpus has learned the simulator's
physics. How much of that transfers is an open question until it is tested
against rig data — and it will transfer better through the `z_` residual columns
than through the raw `s_` columns, because residuals cancel whatever the model
and the real engine agree on and leave only the disagreement.

The single highest-value next step is not more synthetic data. It is a
healthy-engine recording from a real rig, used to re-measure `sigma.json` and to
re-identify the physics parameters. Until then, treat any accuracy figure from
this corpus as an upper bound.
