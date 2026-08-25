import { useState, useEffect, useCallback, useRef } from 'react';

// ═══ 大屏轮播模式 ═══
// 自动轮播: Andon → 健康度 → OEE → 3D工厂 → 月度报表
// 支持全屏 / 手动切换 / 自定义间隔

interface CarouselProps {
  views: { key: string; label: string; icon: string; component: React.ReactNode }[];
  intervalSec?: number;
}

export default function DashboardCarousel({ views, intervalSec = 30 }: CarouselProps) {
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);
  const progressRef = useRef<any>(null);

  const goTo = useCallback((index: number) => {
    setCurrent(((index % views.length) + views.length) % views.length);
    setProgress(0);
  }, [views.length]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Auto-advance with progress bar
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
      return;
    }
    const startTime = Date.now();
    const duration = intervalSec * 1000;
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min((elapsed / duration) * 100, 100));
    }, 100);
    timerRef.current = setTimeout(() => {
      next();
    }, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [isPlaying, current, intervalSec, next]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'f' || e.key === 'F') toggleFS();
      if (e.key === 'p' || e.key === 'P') setIsPlaying(p => !p);
      if (e.key === 'Escape' && fullscreen) { document.exitFullscreen(); setFullscreen(false); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [next, prev, fullscreen]);

  const toggleFS = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const view = views[current];

  return (
    <div ref={containerRef} style={{
      position: 'relative', width: '100%', height: '100vh', background: '#0a0e1a',
      fontFamily: "'Segoe UI',system-ui,sans-serif", overflow: 'hidden',
    }}>
      {/* Current view */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        {view.component}
      </div>

      {/* Top bar overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'linear-gradient(180deg, rgba(10,14,26,0.95) 0%, rgba(10,14,26,0.7) 70%, transparent 100%)',
        padding: '12px 24px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* View tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {views.map((v, i) => (
              <button key={v.key} onClick={() => goTo(i)} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.2s',
                background: i === current ? 'rgba(59,130,246,0.3)' : 'rgba(30,41,59,0.5)',
                color: i === current ? '#93c5fd' : '#64748b',
                borderBottom: i === current ? '2px solid #3b82f6' : '2px solid transparent',
              }}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {current + 1}/{views.length} | {isPlaying ? `${intervalSec}s` : '暂停'}
            </span>
            <button onClick={prev} style={ctrlBtn}>◀</button>
            <button onClick={() => setIsPlaying(p => !p)} style={{ ...ctrlBtn, width: 44 }}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={next} style={ctrlBtn}>▶</button>
            <button onClick={toggleFS} style={ctrlBtn}>{fullscreen ? '⊡' : '⊞'}</button>
          </div>
        </div>

        {/* Progress bar */}
        {isPlaying && (
          <div style={{ height: 3, background: 'rgba(148,163,184,0.1)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
              borderRadius: 2, transition: 'width 0.1s linear',
            }} />
          </div>
        )}
      </div>

      {/* Bottom hint */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
        fontSize: 11, color: 'rgba(148,163,184,0.4)', pointerEvents: 'none',
      }}>
        ← → 切换 | P 暂停 | F 全屏 | Esc 退出
      </div>
    </div>
  );
}

const ctrlBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)',
  background: 'rgba(30,41,59,0.6)', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
