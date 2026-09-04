/**
 * AUTONOMOUS MAINTENANCE ADVISORY
 *
 * Turns a diagnosis into an action: what the operator does now (in flight) and
 * what the maintenance crew does on the ground, with a deadline. Every advisory
 * carries the evidence that produced it, so a maintenance engineer can audit
 * why the twin asked for the work.
 */

export const ACTION_LIBRARY = {
  misfire: {
    flight: 'Reduce power to 65%. Expect roughness. Monitor CHT spread and vibration.',
    ground: 'Remove and inspect plugs, leads and coil on the affected cylinder. Compression-test the cylinder before return to service.',
    urgency: 'before-next-flight', mmh: 2.0, part: 'Spark plug set / ignition coil',
  },
  plug_fouling: {
    flight: 'Lean the mixture and run at higher power briefly to burn off deposits. Monitor for recurrence.',
    ground: 'Clean or replace plugs; investigate oil consumption and fuel grade if fouling recurs.',
    urgency: 'within-10h', mmh: 1.5, part: 'Spark plug set',
  },
  detonation: {
    flight: 'IMMEDIATE: reduce MAP, enrich mixture, reduce power. Detonation destroys pistons in minutes.',
    ground: 'Borescope all cylinders for crown erosion. Verify fuel grade, ignition timing and CHT sensor calibration.',
    urgency: 'immediate', mmh: 4.0, part: 'Borescope inspection kit',
  },
  ignition_timing: {
    flight: 'Reduce to 70% power. Expect elevated EGT and reduced available thrust.',
    ground: 'Verify crank/cam sensor gap and phasing; re-flash ECU ignition map; confirm advance against a timing light.',
    urgency: 'before-next-flight', mmh: 3.0, part: 'Crank position sensor',
  },
  valve_leak: {
    flight: 'Reduce power on the affected bank. Monitor for further EGT rise.',
    ground: 'Leak-down test the cylinder. Expect exhaust valve/seat replacement; inspect the valve guide.',
    urgency: 'before-next-flight', mmh: 8.0, part: 'Exhaust valve & seat kit',
  },
  injector_clog: {
    flight: 'Enrich mixture. Do not run the affected cylinder lean of peak.',
    ground: 'Ultrasonically clean or replace the injector; flow-bench the full set; check fuel filter condition.',
    urgency: 'within-10h', mmh: 2.5, part: 'Fuel injector (1 off)',
  },
  injector_leak: {
    flight: 'Reduce power. Watch for bore washing and plug fouling on the affected cylinder.',
    ground: 'Replace the injector. Inspect the cylinder bore for washing and check the oil for fuel dilution.',
    urgency: 'immediate', mmh: 3.0, part: 'Fuel injector (1 off)',
  },
  fuel_pump: {
    flight: 'Switch to backup pump if fitted. Reduce power to stay within available fuel flow. Plan diversion.',
    ground: 'Replace the fuel pump. Inspect the filter, lines and tank pickup for restriction.',
    urgency: 'immediate', mmh: 4.0, part: 'Electric fuel pump',
  },
  fuel_contam: {
    flight: 'Reduce power. Expect erratic running. Land as soon as practical.',
    ground: 'Drain and sample the fuel. Purge tanks and lines; replace filters; flow-check injectors.',
    urgency: 'immediate', mmh: 6.0, part: 'Filter set, fuel sampling kit',
  },
  oil_pressure_loss: {
    flight: 'EMERGENCY: reduce to minimum power for level flight. Land or recover immediately - bearing failure follows.',
    ground: 'Do not run the engine. Check oil level, pressure relief valve, pump drive and pickup screen. Inspect the filter for bearing material.',
    urgency: 'immediate', mmh: 6.0, part: 'Oil pump / relief valve',
  },
  oil_degradation: {
    flight: 'Reduce power to lower oil temperature. Monitor pressure at temperature.',
    ground: 'Change oil and filter. Send a sample for spectrographic analysis; shorten the oil-change interval.',
    urgency: 'within-10h', mmh: 1.5, part: 'Oil & filter kit',
  },
  coolant_loss: {
    flight: 'Reduce power immediately. Increase airspeed for cooling. Monitor CHT - shut down before 135 °C.',
    ground: 'Pressure-test the cooling system. Inspect hoses, radiator core, water pump seal and head gaskets.',
    urgency: 'immediate', mmh: 5.0, part: 'Coolant, hose set, pump seal',
  },
  radiator_block: {
    flight: 'Increase airspeed, reduce power. Both oil and coolant circuits are affected.',
    ground: 'Inspect and clear the cooling duct and both cores. Check for FOD, insect blockage or duct-door failure.',
    urgency: 'before-next-flight', mmh: 2.0, part: 'Duct inspection / cleaning',
  },
  bearing_wear: {
    flight: 'Reduce power and avoid high-load transients. Monitor oil pressure and vibration.',
    ground: 'Filter and magnetic-plug inspection for bearing material. Oil analysis. Plan bottom-end overhaul.',
    urgency: 'immediate', mmh: 40.0, part: 'Main & rod bearing set',
  },
  prop_imbalance: {
    flight: 'Reduce RPM to move off resonance. Avoid the affected RPM band.',
    ground: 'Inspect blades for damage, erosion and moisture ingress. Dynamically balance the propeller.',
    urgency: 'before-next-flight', mmh: 3.0, part: 'Prop balance kit / blade set',
  },
  gearbox_wear: {
    flight: 'Reduce power. Avoid rapid throttle transients that shock-load the gear train.',
    ground: 'Inspect the gearbox magnetic plug and slipper clutch. Check gear-tooth condition and backlash.',
    urgency: 'within-10h', mmh: 12.0, part: 'Reduction gear set / clutch',
  },
  turbo_wastegate: {
    flight: 'Expect reduced power, worst at altitude. Descend to restore available MAP. Re-plan the mission ceiling.',
    ground: 'Inspect the wastegate actuator, linkage and turbine. Check for coking and shaft play.',
    urgency: 'before-next-flight', mmh: 5.0, part: 'Wastegate actuator / turbo cartridge',
  },
  induction_leak: {
    flight: 'Expect reduced power and a lean shift. Enrich manually if available.',
    ground: 'Pressure-test the induction system. Replace the air filter; inspect couplings and clamps.',
    urgency: 'before-next-flight', mmh: 2.0, part: 'Air filter / induction hose set',
  },
  alternator_fail: {
    flight: 'Shed non-essential electrical load NOW. Battery endurance is the mission limit - see the countdown.',
    ground: 'Test the alternator, regulator, drive belt and field wiring. Replace as required.',
    urgency: 'immediate', mmh: 3.0, part: 'Alternator / voltage regulator',
  },
  regulator_fault: {
    flight: 'Isolate the alternator if bus voltage exceeds 15.5 V. Overvoltage will damage the ECU and battery.',
    ground: 'Replace the voltage regulator. Check the battery for thermal damage and the ECU for overvoltage faults.',
    urgency: 'immediate', mmh: 2.0, part: 'Voltage regulator',
  },
  sensor_drift: {
    flight: 'NO ENGINE ACTION REQUIRED. Indication is unreliable - fly on the twin’s model estimate.',
    ground: 'Replace the affected thermocouple and check the connector and harness for corrosion.',
    urgency: 'within-10h', mmh: 1.0, part: 'Thermocouple / harness',
  },
  sensor_dropout: {
    flight: 'NO ENGINE ACTION REQUIRED. Channel invalid; the twin has substituted its model estimate.',
    ground: 'Trace the open circuit: sensor, connector, harness, then ECU input.',
    urgency: 'before-next-flight', mmh: 1.5, part: 'Sensor / connector kit',
  },
  oilpress_sensor: {
    flight: 'NO ENGINE ACTION REQUIRED. Oil temperature and vibration are normal - the transducer is at fault, not the pump.',
    ground: 'Replace the oil pressure transducer. Verify against a mechanical gauge before return to service.',
    urgency: 'before-next-flight', mmh: 1.0, part: 'Oil pressure transducer',
  },
}

const URGENCY_RANK = { immediate: 0, 'before-next-flight': 1, 'within-10h': 2, monitor: 3 }
export const URGENCY_LABEL = {
  immediate: 'IMMEDIATE', 'before-next-flight': 'BEFORE NEXT FLIGHT',
  'within-10h': 'WITHIN 10 FLIGHT HOURS', monitor: 'MONITOR',
}
const URGENCY_BAND = { immediate: 'critical', 'before-next-flight': 'serious', 'within-10h': 'warning', monitor: 'good' }

/**
 * Compose the live advisory list from diagnosis, trends, wear and limits.
 * @returns [{ id, title, band, urgency, flight, ground, why, deadline }]
 */
export function buildAdvisories(a, wear, rul, elapsedS) {
  const out = []

  // 1. The isolated fault, if the detector has committed to one.
  if (a.best && a.score > 0.4) {
    const lib = ACTION_LIBRARY[a.best.id]
    if (lib) {
      const cyl = a.cylinder != null ? ` — CYL ${a.cylinder + 1}` : ''
      out.push({
        id: `fault:${a.best.id}`,
        title: a.best.label + cyl,
        band: URGENCY_BAND[lib.urgency], urgency: lib.urgency,
        flight: lib.flight, ground: lib.ground, part: lib.part, mmh: lib.mmh,
        confidence: a.best.confidence,
        why: a.evidence.slice(0, 3).map(e =>
          `${e.label} ${e.z > 0 ? '+' : '−'}${Math.abs(e.z).toFixed(1)}σ vs model`),
      })
    }
  }

  // 2. Parameters projected to reach a certified limit inside the mission.
  for (const t of a.trends) {
    // Only *predict* an exceedance that has not happened yet. Once a parameter
    // is already past its limit the limit alert owns it, and a "reaches the
    // limit in 0.0 min" advisory is noise.
    if (t.band === 'critical') continue
    if (t.ttl != null && t.ttl < 1800 && t.ttl > 0) {
      const mins = t.ttl / 60
      out.push({
        id: `trend:${t.key}`,
        title: `${t.label} projected to reach limit`,
        band: mins < 3 ? 'critical' : mins < 10 ? 'serious' : 'warning',
        urgency: mins < 5 ? 'immediate' : 'before-next-flight',
        flight: `At the current trend (${t.slopePerMin > 0 ? '+' : ''}${t.slopePerMin.toFixed(2)}/min) the limit of ${t.target} is reached ${mins < 0.5 ? 'imminently' : `in ${mins.toFixed(1)} min`}. Reduce power or change flight condition now.`,
        ground: 'Investigate the root cause before the next sortie.',
        why: [`Now ${t.value.toFixed(1)}, limit ${t.target}, slope ${t.slopePerMin.toFixed(2)}/min over a 90 s window`],
        deadlineMin: mins,
      })
    }
  }

  // 3. Life-limited item approaching its threshold.
  const lim = rul?.limiting
  if (lim && lim.hours < 60) {
    out.push({
      id: `rul:${lim.id}`,
      title: `${lim.label} — ${lim.hours.toFixed(1)} h remaining useful life`,
      band: lim.hours < 10 ? 'critical' : lim.hours < 25 ? 'serious' : 'warning',
      urgency: lim.hours < 10 ? 'immediate' : 'within-10h',
      flight: 'Reduce operating severity (power, CHT, knock) to extend remaining life.',
      ground: `Schedule ${lim.label.toLowerCase()} inspection/replacement. ${(lim.lifeUsedPct).toFixed(1)}% of life consumed at the current rate.`,
      why: [`Damage rate ${(lim.ratePerHour * 100).toFixed(2)} %/h — ${(lim.ratePerHour / (1 / 1200)).toFixed(0)}× the nominal cruise rate`],
    })
  }

  // 4. Subsystem health degraded without a committed diagnosis.
  for (const sub of a.health.subsystems) {
    if (sub.value < 60 && !out.some(o => o.id.includes(sub.id))) {
      out.push({
        id: `health:${sub.id}`,
        title: `${sub.label} health ${sub.value.toFixed(0)}%`,
        band: sub.band, urgency: sub.value < 35 ? 'immediate' : 'monitor',
        flight: 'Monitor. Reduce demand on this subsystem where the mission allows.',
        ground: 'Inspect at the next scheduled maintenance opportunity.',
        why: sub.drivers.map(d => d.label),
      })
    }
  }

  out.sort((x, y) => (URGENCY_RANK[x.urgency] - URGENCY_RANK[y.urgency]) || (x.deadlineMin ?? 999) - (y.deadlineMin ?? 999))

  // Trend advisories are symptoms of the diagnosed fault, and a single fault
  // trips several at once. Keep the two most urgent so they inform the
  // operator's immediate action, and drop the rest as duplication.
  let trendsKept = 0
  const trimmed = out.filter(o => !o.id.startsWith('trend:') || ++trendsKept <= 2)

  // The root-cause diagnosis is what the maintenance crew actually actions, so
  // it is always in the list even when its own urgency ranks below a symptom.
  const fault = trimmed.find(o => o.id.startsWith('fault:'))
  const rest = trimmed.filter(o => o !== fault).slice(0, fault ? 5 : 6)
  return fault ? [fault, ...rest] : rest
}
