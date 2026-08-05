import React, { useState, useEffect } from 'react';

export default function Preloader({ onFinished }) {
  const [phase, setPhase] = useState(() => {
    // Check if already preloaded in this session
    try {
      if (sessionStorage.getItem('cf_has_preloaded') === 'true') {
        return 'done';
      }
    } catch (_) {}
    return 'animating'; // 'animating' -> 'slideup' -> 'done'
  });

  useEffect(() => {
    if (phase === 'done') {
      onFinished?.();
      return;
    }

    // Mark preloaded in session storage
    try {
      sessionStorage.setItem('cf_has_preloaded', 'true');
    } catch (_) {}

    // Timeline: 1200ms animation -> slide up -> done
    const timer = setTimeout(() => {
      setPhase('slideup');
      setTimeout(() => {
        setPhase('done');
        onFinished?.();
      }, 650);
    }, 1350);

    return () => clearTimeout(timer);
  }, [phase, onFinished]);

  if (phase === 'done') return null;

  const isSlideUp = phase === 'slideup';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0,
        width: '100vw', height: '100vh',
        zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#090d16',
        transform: isSlideUp ? 'translateY(-100%)' : 'translateY(0)',
        transition: 'transform 0.65s cubic-bezier(0.77, 0, 0.175, 1)',
        overflow: 'hidden',
        pointerEvents: isSlideUp ? 'none' : 'auto',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
      }}
    >
      {/* Background glowing ambient light blobs */}
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(90px)', opacity: 0.6, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', left: '20%', width: '50%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(37, 99, 235, 0.55) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '15%', width: '60%', height: '60%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(124, 58, 237, 0.5) 0%, transparent 70%)' }} />
      </div>

      {/* Main Branding Box */}
      <div style={{
        position: 'relative', zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        animation: 'preloaderPulse 1.2s ease-out forwards'
      }}>
        {/* Animated Logo Container */}
        <div style={{
          width: '90px', height: '90px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative'
        }}>
          {/* Subtle spinning glow ring behind logo */}
          <div style={{
            position: 'absolute', inset: '-6px', borderRadius: '50%',
            background: 'conic-gradient(from 0deg, #2563eb, #7c3aed, #ec4899, #2563eb)',
            opacity: 0.7, filter: 'blur(6px)',
            animation: 'spin 3s linear infinite'
          }} />
          
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: '#090d16', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 0 20px rgba(37, 99, 235, 0.3)'
          }}>
            <img
              src="/Cardflow 1.png"
              alt="CardFlow Logo"
              style={{
                width: '64px', height: '64px', objectFit: 'contain',
                filter: 'drop-shadow(0 4px 16px rgba(37,99,235,0.6))'
              }}
            />
          </div>
        </div>

        {/* Brand Name */}
        <h1 style={{
          fontFamily: '"Saira Semi Condensed", sans-serif',
          fontSize: '28px', fontWeight: 800,
          background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          letterSpacing: '0.04em', margin: '0 0 8px 0', textTransform: 'uppercase'
        }}>
          CardFlow ID System
        </h1>

        {/* Subtitle Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 14px', borderRadius: '20px',
          background: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)',
          color: '#93c5fd', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', fontFamily: 'var(--font-family)'
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 8px #3b82f6' }} />
          Enterprise ID Card Management
        </div>

        {/* Sleek Progress Line */}
        <div style={{
          width: '160px', height: '3px', background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '3px', marginTop: '28px', overflow: 'hidden', position: 'relative'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%',
            width: '100%', background: 'linear-gradient(90deg, #2563eb, #7c3aed)',
            borderRadius: '3px',
            animation: 'preloaderProgress 1.2s ease-in-out forwards'
          }} />
        </div>
      </div>

      <style>{`
        @keyframes preloaderProgress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(0%); }
        }
        @keyframes preloaderPulse {
          0% { opacity: 0; transform: scale(0.92); }
          30% { opacity: 1; transform: scale(1); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
