import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useTranslation } from 'react-i18next';
import { maintenanceApi } from '../api/maintenance';

const STATUS_COLORS: Record<string, number> = {
  active: 0x22c55e, online: 0x22c55e,
  idle: 0xeab308, offline: 0x6b7280,
  maintenance: 0x3b82f6,
  fault: 0xef4444, repair: 0xf97316,
  scrapped: 0x374151,
};

const GRADE_COLORS: Record<string, number> = {
  A: 0x22c55e, B: 0x84cc16, C: 0xeab308, D: 0xf97316, F: 0xef4444,
};

export default function IsolatedFactory3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>({});
  const [healthData, setHealthData] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'health' | 'status'>('health');
  const [autoRotate, setAutoRotate] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const { t } = useTranslation();

  const fetchData = useCallback(async () => {
    try {
      const res = await maintenanceApi.getHealth();
      if (res.success) {
        setHealthData(res.data || []);
        setStats(res.summary);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const t = setInterval(fetchData, 30000); return () => clearInterval(t); }, [fetchData]);

  useEffect(() => {
    if (!mountRef.current || healthData.length === 0) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    scene.fog = new THREE.Fog(0x0a0e1a, 30, 60);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(15, 12, 15);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const pointLight = new THREE.PointLight(0x3b82f6, 0.3, 30);
    pointLight.position.set(-5, 8, -5);
    scene.add(pointLight);

    const gridHelper = new THREE.GridHelper(24, 24, 0x1e293b, 0x1e293b);
    scene.add(gridHelper);
    const groundGeo = new THREE.PlaneGeometry(24, 24);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x111827, transparent: true, opacity: 0.8 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    const equipmentMeshes: any[] = [];
    const cols = Math.ceil(Math.sqrt(healthData.length));
    const spacing = 2.2;
    const offsetX = -(cols * spacing) / 2 + spacing / 2;
    const offsetZ = -(Math.ceil(healthData.length / cols) * spacing) / 2 + spacing / 2;

    healthData.forEach((eq: any, i: number) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = offsetX + col * spacing;
      const z = offsetZ + row * spacing;

      const statusColor = STATUS_COLORS[eq.status] ?? 0x6b7280;
      const geo = new THREE.BoxGeometry(1.8, eq.health_score != null ? (eq.health_score / 100) * 2 + 0.3 : 1.2, 1.8);
      const mat = new THREE.MeshStandardMaterial({ color: statusColor, metalness: 0.3, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, (geo.parameters.height ?? 1) / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { eq, index: i };
      scene.add(mesh);
      equipmentMeshes.push(mesh);

      if (eq.equipment_name) {
        const labelGeo = new THREE.PlaneGeometry(1.6, 0.3);
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 256, 48);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(eq.equipment_name.slice(0, 14), 128, 30);
        const labelTex = new THREE.CanvasTexture(canvas);
        const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(x, (geo.parameters.height ?? 1) + 0.3, z);
        label.rotation.x = -Math.PI / 4;
        scene.add(label);
      }
    });

    sceneRef.current = { scene, camera, renderer, equipmentMeshes };

    let animId: number;
    let lastInteraction = Date.now();
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (autoRotate && Date.now() - lastInteraction > 3000) {
        scene.rotation.y += 0.003;
      }
      renderer.render(scene, camera);
    };
    animate();

    const onMouseMove = (e: MouseEvent) => {
      lastInteraction = Date.now();
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(equipmentMeshes);
      container.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    };
    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(equipmentMeshes);
      if (intersects.length > 0) { setSelected(intersects[0].object.userData.eq); }
      else { setSelected(null); }
    };
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      sceneRef.current = {};
    };
  }, [healthData, autoRotate]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', color: '#e2e8f0' }}>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t('factory3d.title', '3D Factory Map')}</span>
        {stats && (
          <span style={{ color: '#94a3b8', fontSize: 13 }}>
            {t('factory3d.total', 'Total')}: {stats.total} &nbsp;
            <span style={{ color: '#22c55e' }}>↑ {stats.online}</span> &nbsp;
            <span style={{ color: '#ef4444' }}>↓ {stats.offline}</span> &nbsp;
            <span style={{ color: '#eab308' }}>⚠ {stats.fault}</span>
          </span>
        )}
        <button onClick={() => setAutoRotate(r => !r)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: autoRotate ? '#1e40af' : '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}>
          {autoRotate ? '⟳ Auto On' : '⟳ Auto Off'}
        </button>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {[['#22c55e','Active'],['#eab308','Idle'],['#ef4444','Fault'],['#6b7280','Offline']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#94a3b8' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
            </span>
          ))}
        </div>
      </div>
      <div ref={mountRef} style={{ flex: 1, position: 'relative', minHeight: 0 }} />
      {selected && (
        <div style={{ position: 'absolute', bottom: 16, left: 16, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 14, minWidth: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{selected.equipment_name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
            <span style={{ color: '#94a3b8' }}>{t('factory3d.status', 'Status')}</span>
            <span style={{ color: STATUS_COLORS[selected.status] ? '#' + STATUS_COLORS[selected.status].toString(16).padStart(6,'0') : '#94a3b8', fontWeight: 600 }}>{selected.status}</span>
            <span style={{ color: '#94a3b8' }}>{t('factory3d.health', 'Health')}</span>
            <span style={{ color: selected.health_score >= 80 ? '#22c55e' : selected.health_score >= 60 ? '#eab308' : '#ef4444', fontWeight: 600 }}>{selected.health_score ?? 'N/A'}%</span>
            {selected.line_name && <><span style={{ color: '#94a3b8' }}>{t('factory3d.line', 'Line')}</span><span>{selected.line_name}</span></>}
            {selected.location && <><span style={{ color: '#94a3b8' }}>{t('factory3d.location', 'Location')}</span><span>{selected.location}</span></>}
          </div>
          <button onClick={() => setSelected(null)} style={{ marginTop: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#334155', color: '#e2e8f0', cursor: 'pointer', fontSize: 12, width: '100%' }}>Close</button>
        </div>
      )}
      {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,14,26,0.7)' }}><span style={{ color: '#94a3b8' }}>Loading...</span></div>}
    </div>
  );
}
