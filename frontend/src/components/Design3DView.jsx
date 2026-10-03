import { useMemo, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { ExtrudeGeometry, Shape, Object3D, Euler } from 'three';
import { accessColor, sunDirection } from '../lib/sun';

function toLocal(lat, lng, origin) {
  const dLat = (lat - origin.lat) * 111320;
  const dLng = (lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return [dLng, dLat];
}

function roofShape(points, origin) {
  if (!points || points.length < 3) return null;
  const coords = points.map((p) => toLocal(p.lat, p.lng, origin));
  return { coords };
}

function CameraRig({ zoom, controlsRef, onChange }) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = Math.max(18, 90 - (zoom || 19) * 2.2);
    camera.position.set(dist * 0.55, dist * 0.62, dist * 0.55);
    camera.lookAt(0, 4, 0);
  }, [camera, zoom]);
  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      target={[0, 4, 0]}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={8}
      maxDistance={160}
      onEnd={onChange}
    />
  );
}

function Ground({ size = 80 }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#6b8f4e" roughness={1} />
    </mesh>
  );
}

function RoofMesh({ roof, origin, base = 8, heatmap }) {
  const geom = useMemo(() => {
    const shaped = roofShape(roof.points, origin);
    if (!shaped) return null;
    const s = new Shape();
    shaped.coords.forEach(([x, z], i) => {
      if (i === 0) s.moveTo(x, z);
      else s.lineTo(x, z);
    });
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [roof, origin]);

  const color = useMemo(() => {
    if (!heatmap?.cells?.length) return '#9a8474';
    const mid = roof.points?.[0];
    if (!mid) return '#9a8474';
    let best = heatmap.cells[0];
    let bestD = 1e9;
    heatmap.cells.forEach((c) => {
      if (c.lat == null) return;
      const d = (c.lat - mid.lat) ** 2 + (c.lng - mid.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    const rgb = accessColor(best.solar_access);
    return `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  }, [heatmap, roof]);

  if (!geom) return null;
  const parapet = 0.55;
  return (
    <group>
      <mesh geometry={geom} position={[0, base, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {(roof.points || []).map((p, i, arr) => {
        const n = arr[(i + 1) % arr.length];
        const [x1, z1] = toLocal(p.lat, p.lng, origin);
        const [x2, z2] = toLocal(n.lat, n.lng, origin);
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dz);
        const ang = Math.atan2(dx, dz);
        return (
          <mesh key={i} position={[(x1 + x2) / 2, base + 0.35 + parapet / 2, (z1 + z2) / 2]} rotation={[0, ang, 0]} castShadow>
            <boxGeometry args={[0.12, parapet, len]} />
            <meshStandardMaterial color="#c5c5c5" />
          </mesh>
        );
      })}
    </group>
  );
}

function PanelTables({ layouts, origin, tilt = 18, azimuth = 180 }) {
  const meshRef = useRef();
  const panels = useMemo(() => (layouts || []).flatMap((l) => l.panels || []).slice(0, 400), [layouts]);
  const dummy = useMemo(() => new Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    const tiltR = (-tilt * Math.PI) / 180;
    const yaw = ((azimuth - 180) * Math.PI) / 180;
    panels.forEach((p, i) => {
      const [x, z] = toLocal(p.lat, p.lng, origin);
      dummy.position.set(x, 8.55, z);
      dummy.rotation.copy(new Euler(tiltR, yaw, 0, 'YXZ'));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [panels, origin, tilt, azimuth, dummy]);

  if (!panels.length) return null;
  const w = panels[0].width_m || 1.13;
  const h = panels[0].height_m || 2.28;
  return (
    <group>
      <instancedMesh ref={meshRef} args={[null, null, panels.length]} castShadow>
        <boxGeometry args={[w, 0.04, h]} />
        <meshStandardMaterial color="#163d2a" metalness={0.25} roughness={0.35} />
      </instancedMesh>
      {panels.slice(0, 64).map((p) => {
        const [x, z] = toLocal(p.lat, p.lng, origin);
        return (
          <group key={p.id} position={[x, 8.15, z]}>
            <mesh position={[-w / 2 + 0.05, 0, -h / 2 + 0.08]}><cylinderGeometry args={[0.025, 0.025, 0.7, 6]} /><meshStandardMaterial color="#64748b" /></mesh>
            <mesh position={[w / 2 - 0.05, 0, -h / 2 + 0.08]}><cylinderGeometry args={[0.025, 0.025, 0.7, 6]} /><meshStandardMaterial color="#64748b" /></mesh>
            <mesh position={[-w / 2 + 0.05, 0, h / 2 - 0.08]}><cylinderGeometry args={[0.025, 0.025, 0.7, 6]} /><meshStandardMaterial color="#64748b" /></mesh>
            <mesh position={[w / 2 - 0.05, 0, h / 2 - 0.08]}><cylinderGeometry args={[0.025, 0.025, 0.7, 6]} /><meshStandardMaterial color="#64748b" /></mesh>
          </group>
        );
      })}
    </group>
  );
}

function Obstructions({ items, origin }) {
  return (items || []).map((o) => {
    const [x, z] = toLocal(o.lat, o.lng, origin);
    const h = Number(o.height_m || 8);
    return (
      <mesh key={o.id} position={[x, h / 2, z]} castShadow>
        <boxGeometry args={[1.6, h, 1.6]} />
        <meshStandardMaterial color={o.type === 'tree' ? '#3f7d3a' : '#94a3b8'} />
      </mesh>
    );
  });
}

function Scene({ design, result, irradiance, heatmapOn, sunOn, day, hour, zoom, controlsRef, onOrbit }) {
  const origin = design.location || { lat: 25.61, lng: 85.14 };
  const sun = sunOn ? sunDirection(origin.lat, day, hour) : [35, 48, 22];
  const layouts = result?.layouts || [];
  const tilt = design.roofs?.[0]?.tilt || 18;
  const azimuth = design.roofs?.[0]?.azimuth || 180;

  return (
    <>
      <color attach="background" args={['#cfe8ff']} />
      <ambientLight intensity={sunOn ? 0.28 : 0.55} />
      <directionalLight
        castShadow
        position={sun}
        intensity={sunOn ? 2.1 : 1.15}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={140}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      {sunOn && (
        <mesh position={sun}>
          <sphereGeometry args={[1.4, 16, 16]} />
          <meshBasicMaterial color="#ffe082" />
        </mesh>
      )}
      <Ground />
      {(design.roofs || []).map((r) => (
        <RoofMesh key={r.id} roof={r} origin={origin} heatmap={heatmapOn ? irradiance : null} />
      ))}
      <PanelTables layouts={layouts} origin={origin} tilt={tilt} azimuth={azimuth} />
      <Obstructions items={design.obstructions} origin={origin} />
      <ContactShadows opacity={0.25} scale={90} blur={2.2} far={20} />
      <CameraRig zoom={zoom} controlsRef={controlsRef} onChange={onOrbit} />
    </>
  );
}

export default function Design3DView({
  design,
  result,
  irradiance,
  heatmapOn,
  sunOn,
  day,
  hour,
  zoom,
  onOrbit,
}) {
  const controlsRef = useRef();
  if (!design) return null;
  return (
    <Canvas shadows camera={{ position: [28, 24, 28], fov: 42 }} dpr={[1, 1.5]}>
      <Scene
        design={design}
        result={result}
        irradiance={irradiance}
        heatmapOn={heatmapOn}
        sunOn={sunOn}
        day={day}
        hour={hour}
        zoom={zoom}
        controlsRef={controlsRef}
        onOrbit={onOrbit}
      />
    </Canvas>
  );
}
