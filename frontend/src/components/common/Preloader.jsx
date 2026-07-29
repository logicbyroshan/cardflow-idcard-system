import React, { useState, useEffect } from 'react';

export default function Preloader({ currentUser, onFinished }) {
  const [typedTitle, setTypedTitle] = useState('');
  const [phase, setPhase]           = useState('typing'); // 'typing' -> 'welcome' -> 'fadeout' -> 'done'

  const userName = currentUser?.first_name
    ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim()
    : (currentUser?.username || 'System Admin');

  useEffect(() => {
    // Typing animation
    const text = 'Adarsh ID Panel';
    let idx = 0;

    const timer = setInterval(() => {
      if (idx < text.length) {
        setTypedTitle(text.slice(0, idx + 1));
        idx++;
      } else {
        clearInterval(timer);
        setTimeout(() => {
          setPhase('welcome');
          setTimeout(() => {
            setPhase('fadeout');
            setTimeout(() => {
              setPhase('done');
              onFinished?.();
            }, 300);
          }, 500);
        }, 150);
      }
    }, 25);

    // Hard fallback timer — ensure preloader NEVER hangs on screen
    const safety = setTimeout(() => {
      setPhase('done');
      onFinished?.();
    }, 1800);

    return () => {
      clearInterval(timer);
      clearTimeout(safety);
    };
  }, [onFinished]);

  if (phase === 'done') return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0,
        width: '100vw', height: '100vh',
        zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#080512',
        opacity: phase === 'fadeout' ? 0 : 1,
        transition: 'opacity 0.3s ease, visibility 0.3s ease',
        overflow: 'hidden',
        pointerEvents: phase === 'fadeout' ? 'none' : 'auto',
      }}
    >
      {/* Background glowing blobs */}
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(100px)', opacity: 0.7, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '60%', height: '60%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(124, 58, 237, 0.6) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '70%', height: '70%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(219, 39, 119, 0.5) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', top: '25%', right: '15%', width: '50%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(79, 70, 229, 0.6) 0%, transparent 70%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        {phase === 'typing' && (
          <>
            <div style={{ width: '80px', height: '80px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/Cardflow 1.png" alt="Logo" style={{ width: '70px', height: '70px', objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }} />
            </div>
            <div style={{ fontFamily: '"Saira Semi Condensed", sans-serif', fontSize: '22px', fontWeight: 700, color: '#fff', letterSpacing: '0.04em', minHeight: '32px' }}>
              {typedTitle}
            </div>
          </>
        )}

        {(phase === 'welcome' || phase === 'fadeout') && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', animation: 'fadeIn 0.2s ease' }}>
            <span style={{ fontSize: '12px', textTransform: 'uppercase', color: '#c084fc', letterSpacing: '0.2em', fontWeight: 700, fontFamily: '"Saira Semi Condensed", sans-serif' }}>
              WELCOME
            </span>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#ffffff', fontFamily: '"Saira Semi Condensed", sans-serif', textShadow: '0 4px 20px rgba(139, 92, 246, 0.5)' }}>
              {userName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
