import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from './i18n';
import type { Locale } from '../../../packages/shared-types/src/factory';

// ── face-api.js CDN paths (lazy loaded) ──
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

type CheckinType = 'in' | 'out' | 'arrive_post' | 'leave_post';
type FaceResult = 'pass' | 'fail' | 'pending';

interface FaceMatch {
  score: number;
  photoUrl: string;
}

interface CheckinState {
  step: 'enter-id' | 'camera' | 'comparing' | 'result' | 'error';
  employeeId: number | null;
  empNo: string;
  empName: string;
  checkinType: CheckinType;
  hasHrPhoto: boolean;
  retryCount: number;
  lastScore: number;
  result: FaceResult;
  failReason: string;
  checkinId: number | null;
  error: string;
}

const CHECKIN_TYPE_KEYS: Record<CheckinType, string> = {
  in: 'hr.mobileCheckin.clockIn',
  out: 'hr.mobileCheckin.clockOut',
  arrive_post: 'hr.mobileCheckin.arrivePost',
  leave_post: 'hr.mobileCheckin.leavePost',
};

const THRESHOLD = 0.85;
const MAX_RETRIES = 3;

// ── Load face-api.js dynamically ──
async function loadFaceApi(): Promise<any> {
  if ((window as any).__faceApiLoaded) return (window as any).__faceApi;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${FACE_API_CDN}/dist/face-api.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('face-api.js failed to load'));
    document.head.appendChild(script);
  });
  const faceApi = (window as any).faceApi;
  await faceApi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceApi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceApi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  (window as any).__faceApiLoaded = true;
  (window as any).__faceApi = faceApi;
  return faceApi;
}

// ── Capture canvas frame ──
async function captureFaceDescriptors(video: HTMLVideoElement): Promise<Float32Array | null> {
  try {
    const faceApi = await loadFaceApi();
    const detections = await faceApi
      .detectSingleFace(video, new faceApi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return detections?.descriptor ?? null;
  } catch {
    return null;
  }
}

// ── Cosine similarity between two descriptors ──
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

// ── Convert base64 dataURL to blob for upload ──
function dataURLtoBlob(dataURL: string): Blob {
  const [meta, data] = dataURL.split(',');
  const mime = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ── Upload photo to static server ──
// Store photo as base64 data URL directly (no file server needed)
async function uploadPhoto(blob: Blob, employeeId: number, prefix: string): Promise<string> {
  return blobToDataURL(blob);
}

// Fallback: embed as base64 data URL (if no upload endpoint)
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ── Get stored embedding for employee ──
async function getStoredEmbedding(employeeId: number): Promise<Float32Array | null> {
  const res = await fetch(`/hr/face/profile/${employeeId}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.success || !json.profile?.hrPhotoEmbedding) return null;
  try {
    const emb = typeof json.profile.hrPhotoEmbedding === 'string'
      ? JSON.parse(json.profile.hrPhotoEmbedding)
      : json.profile.hrPhotoEmbedding;
    return new Float32Array(emb);
  } catch { return null; }
}

export function MobileCheckin({ locale }: { locale: Locale }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CheckinState>({
    step: 'enter-id', employeeId: null, empNo: '', empName: '',
    checkinType: 'in', hasHrPhoto: false, retryCount: 0,
    lastScore: 0, result: 'pending', failReason: '', checkinId: null, error: '',
  });
  const [empInput, setEmpInput] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState('');
  const [cameraError, setCameraError] = useState('');

  // ── Start camera ──
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError('');
    } catch (e: any) {
      setCameraError(t('hr.mobileCheckin.cameraError', locale));
    }
  }, []);

  // ── Stop camera ──
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Step 1: Enter employee ID ──
  const handleEnterId = async () => {
    if (!empInput.trim()) return;
    // Try to find employee by code or id
    const res = await fetch(`/hr/mobile/employee/${empInput.trim()}`);
    if (!res.ok) { setState(s => ({ ...s, error: t('hr.mobileCheckin.employeeNotFound', locale) })); return; }
    const json = await res.json();
    if (!json.success || !json.employee) { setState(s => ({ ...s, error: t('hr.mobileCheckin.employeeNotFound', locale) })); return; }
    const emp = json.employee;
    // Check if has face profile
    const profileRes = await fetch(`/hr/face/profile/${emp.id}`);
    const profileJson = profileRes.ok ? await profileRes.json() : { success: false };
    setState(s => ({
      ...s,
      step: 'camera',
      employeeId: emp.id,
      empNo: emp.code,
      empName: emp.name_zh,
      hasHrPhoto: profileJson.success && profileJson.profile?.hasHrPhoto,
      error: '',
    }));
    await startCamera();
  };

  // ── Step 2: Capture and compare ──
  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !state.employeeId) return;
    stopCamera();
    setState(s => ({ ...s, step: 'comparing' }));

    try {
      // Capture frame
      const canvas = canvasRef.current!;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const dataURL = canvas.toDataURL('image/jpeg', 0.85);
      const blob = dataURLtoBlob(dataURL);
      const photoUrl = await uploadPhoto(blob, state.employeeId, 'checkin').catch(() => dataURL);

      // Get stored embedding
      const storedEmb = await getStoredEmbedding(state.employeeId);
      if (!storedEmb) {
        setState(s => ({ ...s, step: 'result', result: 'fail',
          failReason: t('hr.mobileCheckin.noFacePhoto', locale), error: '' }));
        return;
      }

      // Load models if needed
      setModelProgress(t('hr.mobileCheckin.loadingModel', locale));
      setLoadingModels(true);
      try {
        await loadFaceApi();
      } finally {
        setLoadingModels(false);
        setModelProgress('');
      }

      // Capture and compare
      // Need to restart camera for capture since we stopped it
      await startCamera();
      await new Promise(r => setTimeout(r, 500)); // warm up
      const liveEmb = await captureFaceDescriptors(video);
      stopCamera();

      if (!liveEmb) {
        const rc = state.retryCount + 1;
        setState(s => ({ ...s, step: 'result', result: 'fail',
          failReason: t('hr.mobileCheckin.noFaceDetected', locale), retryCount: rc, error: '' }));
        return;
      }

      const score = cosineSimilarity(liveEmb, storedEmb);
      const pass = score >= THRESHOLD;
      const rc = pass ? 0 : state.retryCount + 1;

      // Submit check-in
      const checkinRes = await fetch('/hr/mobile/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: state.employeeId,
          checkinType: state.checkinType,
          locationType: 'mobile',
          faceScore: Math.round(score * 100) / 100,
          facePhotoUrl: photoUrl,
          faceResult: pass ? 'pass' : 'fail',
          deviceInfo: navigator.userAgent,
          failReason: pass ? null : `${t('hr.mobileCheckin.lastScore', locale)} ${Math.round(score*100)}% ${t('hr.mobileCheckin.threshold', locale)} ${THRESHOLD*100}%`,
          retryCount: rc,
          gpsLat: null, gpsLng: null, gpsAccuracy: null,
        }),
      });
      const checkinJson = await checkinRes.json();

      setState(s => ({
        ...s,
        step: 'result',
        result: pass ? 'pass' : 'fail',
        lastScore: score,
        failReason: pass ? '' : (checkinJson.failReason || t('hr.mobileCheckin.matchFailed', locale)),
        retryCount: rc,
        checkinId: checkinJson.checkinId || null,
        error: checkinJson.error || '',
      }));
    } catch (e: any) {
      setState(s => ({ ...s, step: 'error', error: e.message }));
    }
  };

  // ── Retry ──
  const handleRetry = () => {
    setState(s => ({ ...s, step: 'camera', error: '' }));
    startCamera();
  };

  // ── Reset ──
  const handleReset = () => {
    stopCamera();
    setState({ step: 'enter-id', employeeId: null, empNo: '', empName: '',
      checkinType: 'in', hasHrPhoto: false, retryCount: 0,
      lastScore: 0, result: 'pending', failReason: '', checkinId: null, error: '' });
    setEmpInput('');
  };

  // ── Render ──
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t('hr.mobileCheckin.title', locale)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{t('hr.mobileCheckin.subtitle', locale)}</div>
        </div>
        {state.empName && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>{state.empNo}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>{state.empName}</div>
          </div>
        )}
      </div>

      <div style={{ padding: 20 }}>
        {/* ── Step: Enter ID ── */}
        {state.step === 'enter-id' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('hr.mobileCheckin.welcome', locale)}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
                {t('hr.mobileCheckin.enterBadge', locale)}
              </div>
              <input
                type="text"
                placeholder={t('hr.mobileCheckin.badgePlaceholder', locale)}
                value={empInput}
                onChange={e => setEmpInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEnterId()}
                style={{ width: '100%', padding: '14px 16px', borderRadius: 10, border: '1px solid #334155',
                  background: '#0f172a', color: '#f1f5f9', fontSize: 16, textAlign: 'center',
                  boxSizing: 'border-box', outline: 'none' }}
              />
              <button className="btn-primary" style={{ width: '100%', marginTop: 12, padding: '14px' }}
                onClick={handleEnterId}>
                {t('hr.mobileCheckin.confirmBadge', locale)}
              </button>
              {state.error && <div style={{ color: '#f87171', marginTop: 10, fontSize: 13 }}>{state.error}</div>}
            </div>

            {/* Check-in type selector */}
            <div style={{ background: '#1e293b', borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{t('hr.mobileCheckin.selectType', locale)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['in','out','arrive_post','leave_post'] as CheckinType[]).map(checkinType => (
                  <button key={checkinType}
                    style={{ padding: '12px 8px', borderRadius: 10, border: '1px solid #334155',
                      background: state.checkinType === checkinType ? '#1d4ed8' : '#0f172a',
                      color: state.checkinType === checkinType ? '#fff' : '#94a3b8',
                      fontSize: 14, cursor: 'pointer', fontWeight: state.checkinType === checkinType ? 600 : 400 }}
                    onClick={() => setState(s => ({ ...s, checkinType }))}>
                    {t(CHECKIN_TYPE_KEYS[checkinType], locale)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Camera ── */}
        {state.step === 'camera' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#1e293b', borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
              <video
                ref={videoRef}
                autoPlay playsInline muted
                style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
              />
              {/* Overlay guide */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  width: 200, height: 200, borderRadius: '50%',
                  border: '3px solid rgba(59,130,246,0.7)',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
                }} />
              </div>
              {cameraError && (
                <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 48 }}>📷</div>
                  <div style={{ color: '#f87171', textAlign: 'center', padding: '0 20px' }}>{cameraError}</div>
                  <button className="btn-ghost" onClick={handleReset}>{t('hr.mobileCheckin.goBack', locale)}</button>
                </div>
              )}
            </div>

            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 4 }}>
                {t('hr.mobileCheckin.threshold', locale)} {THRESHOLD*100}% · {t('hr.mobileCheckin.retryCount', locale)} {state.retryCount}/{MAX_RETRIES}
              </div>
              {state.retryCount > 0 && (
                <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>
                  {t('hr.mobileCheckin.lastScore', locale)}: {Math.round(state.lastScore*100)}%
                </div>
              )}
              <button className="btn-primary" style={{ width: '100%', padding: '16px', fontSize: 16 }}
                onClick={handleCapture} disabled={!!cameraError}>
                📸 {t('hr.mobileCheckin.takePhoto', locale)}
              </button>
            </div>

            <button className="btn-ghost" style={{ color: '#64748b' }} onClick={handleReset}>
              ← {t('hr.mobileCheckin.goBack', locale)}
            </button>
          </div>
        )}

        {/* ── Step: Comparing ── */}
        {state.step === 'comparing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20 }}>
            <div style={{ fontSize: 64, animation: 'pulse 1.5s infinite' }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{modelProgress || t('hr.mobileCheckin.recognizing', locale)}</div>
            <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>
              {t('hr.mobileCheckin.facePrompt', locale)}
            </div>
          </div>
        )}

        {/* ── Step: Result ── */}
        {state.step === 'result' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {state.result === 'pass' ? (
              <div style={{ background: 'linear-gradient(135deg, #052e16, #064e3b)', borderRadius: 20, padding: 32, textAlign: 'center', border: '1px solid #22c55e33' }}>
                <div style={{ fontSize: 72, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>{t('hr.mobileCheckin.success', locale)}</div>
                <div style={{ fontSize: 15, color: '#86efac' }}>{t(CHECKIN_TYPE_KEYS[state.checkinType], locale)}</div>
                <div style={{ fontSize: 13, color: '#4ade8080', marginTop: 8 }}>
                  {t('hr.mobileCheckin.lastScore', locale)} {Math.round(state.lastScore*100)}%
                </div>
                {state.checkinId && (
                  <div style={{ fontSize: 11, color: '#4ade8040', marginTop: 4 }}>
                    {t('hr.mobileCheckin.record', locale)} #{state.checkinId}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: 'linear-gradient(135deg, #450a0a, #7f1d1d)', borderRadius: 20, padding: 32, textAlign: 'center', border: '1px solid #ef444433' }}>
                <div style={{ fontSize: 72, marginBottom: 12 }}>❌</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fca5a5', marginBottom: 8 }}>
                  {state.retryCount >= MAX_RETRIES ? t('hr.mobileCheckin.fail', locale) : t('hr.mobileCheckin.scoreLow', locale)}
                </div>
                <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>{state.failReason}</div>
                {state.retryCount < MAX_RETRIES ? (
                  <button className="btn-primary" style={{ width: '100%', padding: '14px' }} onClick={handleRetry}>
                    {t('hr.mobileCheckin.retry', locale)} ({state.retryCount+1}/{MAX_RETRIES})
                  </button>
                ) : (
                  <div style={{ fontSize: 13, color: '#fca5a5', padding: '12px', background: '#450a0a', borderRadius: 10 }}>
                    {t('hr.mobileCheckin.maxRetries', locale)}<br/>{t('hr.mobileCheckin.contactHR', locale)}
                  </div>
                )}
              </div>
            )}
            <button className="btn-ghost" style={{ color: '#64748b' }} onClick={handleReset}>
              ← {t('hr.mobileCheckin.restartCheckin', locale)}
            </button>
          </div>
        )}

        {/* ── Step: Error ── */}
        {state.step === 'error' && (
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, color: '#f87171', marginBottom: 16 }}>{state.error}</div>
            <button className="btn-ghost" onClick={handleReset}>{t('hr.mobileCheckin.restart', locale)}</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .btn-primary { background: #1d4ed8; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { background: #1e40af; }
        .btn-primary:disabled { background: #1e3a5f; color: #64748b; cursor: not-allowed; }
        .btn-ghost { background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 10px; font-size: 14px; cursor: pointer; padding: 10px 16px; }
      `}</style>
    </div>
  );
}
