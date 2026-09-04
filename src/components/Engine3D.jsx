import React, { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { FIRING_ORDER } from '../sim/spec.js'

/* ── materials ─────────────────────────────────────────────────────────── */
const ALLOY = { color: '#a9b5c2', metalness: 0.72, roughness: 0.34 }
const DARK  = { color: '#3c4650', metalness: 0.65, roughness: 0.5 }
const BLACK = { color: '#171d24', metalness: 0.4,  roughness: 0.75 }
const COPPER= { color: '#9a6b43', metalness: 0.9,  roughness: 0.35 }

/** CHT → surface colour. Cool alloy through to glowing red at the limit. */
function heatColor(cht) {
  const t = THREE.MathUtils.clamp((cht - 100) / 45, 0, 1)
  const cold = new THREE.Color('#a9b5c2')
  const warm = new THREE.Color('#c8763a')
  const hot  = new THREE.Color('#e03b2a')
  return t < 0.6 ? cold.clone().lerp(warm, t / 0.6) : warm.clone().lerp(hot, (t - 0.6) / 0.4)
}

/** Wraps any sub-assembly so the diagnosis can make it pulse. */
function Part({ id, highlight, children, ...rest }) {
  const g = useRef()
  const on = highlight === id
  useFrame(({ clock }) => {
    if (!g.current) return
    const k = on ? 1 + Math.sin(clock.elapsedTime * 6) * 0.035 : 1
    g.current.scale.setScalar(k)
  })
  return <group ref={g} {...rest}>{children}</group>
}

function HaloRing({ show, radius = 0.9, color = '#ff6b6b' }) {
  const r = useRef()
  useFrame(({ clock }) => {
    if (!r.current) return
    r.current.material.opacity = show ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 5) : 0
    r.current.rotation.z = clock.elapsedTime * 0.9
  })
  return (
    <mesh ref={r} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.022, 8, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0} />
    </mesh>
  )
}

/* ── one cylinder assembly ─────────────────────────────────────────────── */
function Cylinder({ index, side, z, cht, egt, burn, rpm, highlight, flagged, onPick, picked }) {
  const glow = useRef()
  const rocker = useRef()
  const phase = FIRING_ORDER.indexOf(index) / 4
  const color = useMemo(() => heatColor(cht ?? 90), [Math.round((cht ?? 90) / 2)])
  const dir = side === 'L' ? -1 : 1

  useFrame(({ clock }) => {
    // Combustion flash, timed on the firing order at the true firing frequency.
    const f = (rpm / 120) // firing events per cylinder per second (4-stroke)
    const u = (clock.elapsedTime * f + phase) % 1
    const spark = Math.max(0, 1 - u * 9)
    const q = THREE.MathUtils.clamp(burn ?? 1, 0, 1)
    if (glow.current) glow.current.material.emissiveIntensity = spark * (0.25 + 3.4 * q * q)
    if (rocker.current) rocker.current.position.y = Math.sin(clock.elapsedTime * f * Math.PI * 2 + phase * 6) * 0.012 * q
  })

  const isHot = (cht ?? 0) > 120
  return (
    <group position={[dir * 0.42, 0, z]} rotation={[0, 0, dir * -Math.PI / 2]}
      onClick={e => { e.stopPropagation(); onPick(index) }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'auto' }}>
      <Part id="cyl" highlight={flagged ? highlight : null}>
        {/* barrel with cooling fins */}
        <mesh position={[0, 0.34, 0]}>
          <cylinderGeometry args={[0.185, 0.20, 0.54, 24]} />
          <meshStandardMaterial {...DARK} color={color.getStyle()} />
        </mesh>
        {[0.13, 0.20, 0.27, 0.34, 0.41, 0.48, 0.55].map((y, i) => (
          <mesh key={i} position={[0, y, 0]}>
            <cylinderGeometry args={[0.255, 0.255, 0.022, 26]} />
            <meshStandardMaterial {...ALLOY} color={color.getStyle()} roughness={0.3} />
          </mesh>
        ))}
        {/* head */}
        <mesh position={[0, 0.665, 0]}>
          <boxGeometry args={[0.40, 0.20, 0.38]} />
          <meshStandardMaterial {...ALLOY} color={color.getStyle()} roughness={0.42} />
        </mesh>
        {/* rocker cover */}
        <mesh ref={rocker} position={[0, 0.80, 0]}>
          <boxGeometry args={[0.34, 0.09, 0.32]} />
          <meshStandardMaterial {...BLACK} />
        </mesh>
        {/* combustion chamber glow */}
        <mesh ref={glow} position={[0, 0.60, 0]}>
          <sphereGeometry args={[0.115, 16, 12]} />
          <meshStandardMaterial color="#ff7a2a" emissive="#ff5410" emissiveIntensity={0} toneMapped={false} />
        </mesh>
        {/* spark plug + injector */}
        <mesh position={[0.13, 0.74, 0.10]} rotation={[0, 0, 0.4]}>
          <cylinderGeometry args={[0.032, 0.032, 0.16, 10]} />
          <meshStandardMaterial {...COPPER} />
        </mesh>
        <mesh position={[-0.13, 0.72, -0.11]} rotation={[0.3, 0, -0.3]}>
          <cylinderGeometry args={[0.035, 0.028, 0.19, 10]} />
          <meshStandardMaterial color="#3a4550" metalness={0.8} roughness={0.4} />
        </mesh>
        {/* exhaust stub */}
        <mesh position={[0, 0.66, -0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.062, 0.062, 0.24, 12]} />
          <meshStandardMaterial color="#5a4034" metalness={0.85} roughness={0.5}
            emissive="#ff4a10" emissiveIntensity={THREE.MathUtils.clamp(((egt ?? 700) - 650) / 700, 0, 0.55)} />
        </mesh>
        {/* intake runner */}
        <mesh position={[0, 0.66, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.22, 12]} />
          <meshStandardMaterial {...ALLOY} />
        </mesh>
        <HaloRing show={flagged} radius={0.44} />
      </Part>
      <Html center distanceFactor={3.2} position={[0, 1.02, 0]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontSize: 10, letterSpacing: '0.06em', whiteSpace: 'nowrap', fontWeight: 700,
          padding: '1px 5px', borderRadius: 100,
          background: flagged ? 'rgba(208,59,59,0.92)' : 'rgba(8,12,17,0.82)',
          border: `1px solid ${flagged ? '#ff8a8a' : isHot ? 'var(--warning)' : 'rgba(147,178,209,0.22)'}`,
          color: flagged ? '#fff' : isHot ? '#fab219' : '#97a8ba',
          outline: picked ? '1px solid #4d9fff' : 'none',
        }}>
          C{index + 1} {(cht ?? 0).toFixed(0)}°
        </div>
      </Html>
    </group>
  )
}

/* ── rotating assemblies ───────────────────────────────────────────────── */
function Propeller({ propRPM, flagged, highlight }) {
  const g = useRef()
  useFrame((_, dt) => { if (g.current) g.current.rotation.z += (propRPM / 60) * dt * Math.PI * 2 * 0.06 })
  return (
    <Part id="prop" highlight={flagged ? highlight : null} position={[0, 0, 1.62]}>
      <group ref={g}>
        {[0, 1, 2].map(i => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
            <boxGeometry args={[0.10, 2.05, 0.028]} />
            <meshStandardMaterial color="#20272f" metalness={0.35} roughness={0.62} />
          </mesh>
        ))}
        <mesh><sphereGeometry args={[0.135, 18, 14]} /><meshStandardMaterial {...ALLOY} /></mesh>
      </group>
      <HaloRing show={flagged} radius={1.12} />
    </Part>
  )
}

function Turbo({ rpm, flagged, highlight }) {
  const t = useRef()
  useFrame((_, dt) => { if (t.current) t.current.rotation.x += dt * (rpm / 4000) * 4 })
  return (
    <Part id="turbo" highlight={flagged ? highlight : null} position={[0.72, -0.42, -0.86]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.24, 0.24, 0.18, 22]} />
        <meshStandardMaterial color="#4d5560" metalness={0.9} roughness={0.35} />
      </mesh>
      <mesh position={[0.17, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.19, 0.19, 0.20, 22]} />
        <meshStandardMaterial color="#5b4438" metalness={0.85} roughness={0.5} />
      </mesh>
      <mesh ref={t} position={[-0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.02, 0.10, 10]} />
        <meshStandardMaterial color="#c9d2dc" metalness={1} roughness={0.2} />
      </mesh>
      <HaloRing show={flagged} radius={0.42} />
    </Part>
  )
}

function Gearbox({ propRPM, flagged, highlight }) {
  return (
    <Part id="gearbox" highlight={flagged ? highlight : null} position={[0, 0, 1.13]}>
      <mesh><cylinderGeometry args={[0.34, 0.40, 0.42, 26]} /><meshStandardMaterial {...ALLOY} roughness={0.45} /></mesh>
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.30, 0.30, 0.46, 26]} /><meshStandardMaterial {...ALLOY} roughness={0.45} />
      </mesh>
      <HaloRing show={flagged} radius={0.55} />
    </Part>
  )
}

/* ── the assembled engine ──────────────────────────────────────────────── */
function EngineModel({ frame, highlight, flagCyl, picked, onPick }) {
  const s = frame?.sensed, truth = frame?.truth
  const rpm = truth?.rpm ?? 0
  const cht = s?.cht ?? [90, 90, 90, 90]
  const egt = s?.egt ?? [700, 700, 700, 700]
  const burn = truth?.cylBurn ?? [1, 1, 1, 1]
  const root = useRef()
  useFrame((_, dt) => { if (root.current) root.current.rotation.y += dt * 0.055 })

  const isPart = id => highlight === id

  return (
    <group ref={root} position={[0, -0.05, 0]} scale={1.06}>
      {/* crankcase */}
      <Part id="crank" highlight={highlight}>
        <mesh><boxGeometry args={[0.60, 0.52, 1.42]} /><meshStandardMaterial {...ALLOY} roughness={0.5} /></mesh>
        <mesh position={[0, -0.34, 0]}><boxGeometry args={[0.52, 0.20, 1.20]} /><meshStandardMaterial {...DARK} /></mesh>
        <HaloRing show={isPart('crank')} radius={0.78} />
      </Part>

      {/* four cylinders, horizontally opposed */}
      {[0, 1, 2, 3].map(i => (
        <Cylinder key={i} index={i} side={i % 2 === 0 ? 'L' : 'R'} z={i < 2 ? 0.40 : -0.40}
          cht={cht[i]} egt={egt[i]} burn={burn[i]} rpm={rpm}
          highlight={highlight} flagged={flagCyl === i} picked={picked === i} onPick={onPick} />
      ))}

      <Gearbox propRPM={truth?.propRPM ?? 0} flagged={isPart('gearbox')} highlight={highlight} />
      <Propeller propRPM={truth?.propRPM ?? 0} flagged={isPart('prop')} highlight={highlight} />
      <Turbo rpm={rpm} flagged={isPart('turbo')} highlight={highlight} />

      {/* oil pan + pump */}
      <Part id="oilpump" highlight={highlight} position={[0, -0.56, 0.10]}>
        <mesh><boxGeometry args={[0.46, 0.20, 0.86]} /><meshStandardMaterial {...BLACK} /></mesh>
        <mesh position={[0, -0.02, -0.52]}><cylinderGeometry args={[0.13, 0.13, 0.20, 18]} /><meshStandardMaterial {...ALLOY} /></mesh>
        <HaloRing show={isPart('oilpump')} radius={0.6} />
      </Part>

      {/* intake plenum */}
      <Part id="intake" highlight={highlight} position={[0, 0.42, 0]}>
        <mesh><boxGeometry args={[0.30, 0.16, 1.10]} /><meshStandardMaterial color="#3f4954" metalness={0.75} roughness={0.45} /></mesh>
        <HaloRing show={isPart('intake')} radius={0.62} />
      </Part>

      {/* fuel rail + pump */}
      <Part id="fuelpump" highlight={highlight} position={[-0.62, 0.10, -0.66]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.10, 0.10, 0.30, 16]} /><meshStandardMaterial color="#46505b" metalness={0.8} roughness={0.4} /></mesh>
        <HaloRing show={isPart('fuelpump')} radius={0.28} />
      </Part>

      {/* alternator */}
      <Part id="alternator" highlight={highlight} position={[-0.62, -0.30, 0.62]}>
        <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.15, 0.15, 0.26, 18]} /><meshStandardMaterial color="#57616d" metalness={0.85} roughness={0.4} /></mesh>
        <HaloRing show={isPart('alternator')} radius={0.34} />
      </Part>

      {/* radiator / oil cooler */}
      <Part id="radiator" highlight={highlight} position={[0, 0.05, -1.18]}>
        <mesh><boxGeometry args={[1.05, 0.62, 0.10]} /><meshStandardMaterial color="#39424d" metalness={0.6} roughness={0.7} /></mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[-0.45 + i * 0.11, 0, 0.055]}>
            <boxGeometry args={[0.028, 0.56, 0.02]} /><meshStandardMaterial {...COPPER} />
          </mesh>
        ))}
        <HaloRing show={isPart('radiator')} radius={0.68} />
      </Part>

      {/* ECU / FADEC */}
      <Part id="ecu" highlight={highlight} position={[0.66, 0.30, 0.72]}>
        <mesh><boxGeometry args={[0.16, 0.26, 0.34]} /><meshStandardMaterial color="#232b34" metalness={0.5} roughness={0.6} /></mesh>
        <mesh position={[0.085, 0.06, 0]}><boxGeometry args={[0.012, 0.03, 0.05]} />
          <meshStandardMaterial color="#35d135" emissive="#35d135" emissiveIntensity={2} toneMapped={false} /></mesh>
        <HaloRing show={isPart('ecu')} radius={0.34} />
      </Part>

      {/* injector rail marker (highlight target for injector faults) */}
      <Part id="injector" highlight={highlight} position={[0, 0.30, 0]}>
        <mesh visible={false}><boxGeometry args={[1.1, 0.4, 1.1]} /></mesh>
        <HaloRing show={isPart('injector')} radius={0.92} color="#fab219" />
      </Part>
    </group>
  )
}

export default function Engine3D({ frame, highlight, flagCyl, picked, onPick }) {
  // A GPU context loss (tab suspend, driver reset, hot reload) otherwise leaves
  // a permanently blank stage; remounting the canvas recovers it.
  const [gen, setGen] = React.useState(0)
  return (
    <Canvas key={gen} camera={{ position: [3.6, 2.0, 3.9], fov: 44 }} dpr={[1, 1.8]}
      gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', e => {
          e.preventDefault(); setTimeout(() => setGen(g => g + 1), 200)
        })
      }}>
      <color attach="background" args={['#0a0f15']} />
      <fog attach="fog" args={['#0a0f15', 7, 16]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#9cc8ef', '#12191f', 1.1]} />
      <directionalLight position={[4, 6, 4]} intensity={2.1} />
      <directionalLight position={[-5, 2.5, -3]} intensity={1.0} color="#6fa9dd" />
      <directionalLight position={[0, 1, 6]} intensity={0.7} color="#dfe9f3" />
      <pointLight position={[0, -1.4, 0.4]} intensity={0.55} color="#ff8a4a" />
      <EngineModel frame={frame} highlight={highlight} flagCyl={flagCyl} picked={picked} onPick={onPick} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.15, 0]}>
        <circleGeometry args={[3.4, 48]} />
        <meshBasicMaterial color="#0e1720" transparent opacity={0.55} />
      </mesh>
      <gridHelper args={[7, 22, '#1b2733', '#131c25']} position={[0, -1.14, 0]} />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={9}
        minPolarAngle={0.25} maxPolarAngle={Math.PI / 2 + 0.25} enableDamping dampingFactor={0.08} />
    </Canvas>
  )
}
