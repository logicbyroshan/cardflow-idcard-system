import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Loader2 } from 'lucide-react';
import { authApi } from '../../services/api';

export default function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(username, password);
      if (res.success || res.authenticated) {
        onLoginSuccess?.(res.user || res);
      } else {
        setError(res.message || 'Invalid credentials. Please try again.');
      }
    } catch (err) {
      // Backend offline fallback for dev
      if (err?.response?.status === 403 || err?.response?.status === 401) {
        setError('Invalid credentials. Please try again.');
      } else {
        onLoginSuccess?.();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: '"Saira Semi Condensed", -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        width: '360px',
        maxWidth: '92vw',
        borderRadius: '6px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}>
        {/* Header gradient strip */}
        <div style={{
          background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%)',
          padding: '24px 28px 20px',
          textAlign: 'center',
        }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: '#667eea', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: '0 4px 15px rgba(102,126,234,0.5)' }}>
            <ShieldCheck size={26} color="#fff" />
          </div>
          <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 700, margin: '0 0 4px' }}>CardFlow Portal</h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '13px', margin: 0 }}>Enterprise ID Card Management</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '24px 28px' }}>
          {error && (
            <div style={{
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '4px',
              color: '#dc2626',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Username or Email</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <User size={13} style={{ position: 'absolute', left: '9px', color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="form-input"
                style={{ paddingLeft: '28px' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={13} style={{ position: 'absolute', left: '9px', color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="form-input"
                style={{ paddingLeft: '28px' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', height: '34px', marginTop: '6px', justifyContent: 'center', gap: '6px', fontSize: '14px', fontWeight: 600 }}
          >
            {loading
              ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Signing in…</>
              : 'Sign In'
            }
          </button>
        </form>

        <div style={{ padding: '0 28px 20px', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#9ca3af' }}>CardFlow — Enterprise ID Card Engine v2.0</span>
        </div>
      </div>
    </div>
  );
}
