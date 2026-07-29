import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, ShieldAlert } from 'lucide-react';

export default function ConfirmDeleteModal({ isOpen, onClose, onConfirm, title = "Confirm Permanent Delete", itemDescription = "this item", requiresCode = false, deleteCode = "" }) {
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (requiresCode && inputCode !== deleteCode) {
      setError('Invalid deletion code entered. Please check and try again.');
      return;
    }
    setError('');
    onConfirm();
    onClose();
  };

  return (
    <div className="drawer-overlay" style={{ alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div
        className="data-card"
        style={{ width: '440px', maxWidth: '90vw', padding: '1.75rem', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <X size={20} />
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1rem' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={28} />
          </div>

          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.35rem' }}>{title}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Are you sure you want to permanently delete {itemDescription}? This action cannot be undone.
            </p>
          </div>

          {requiresCode && (
            <div style={{ width: '100%', textAlign: 'left', marginTop: '0.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Enter Verification Code: <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>{deleteCode}</span>
              </label>
              <input
                type="text"
                value={inputCode}
                onChange={(e) => { setInputCode(e.target.value); setError(''); }}
                placeholder="Type deletion code"
                style={{ width: '100%', padding: '0.65rem 1rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', outline: 'none' }}
              />
              {error && <span style={{ fontSize: '0.75rem', color: 'var(--accent-rose)', marginTop: '0.35rem', display: 'block' }}>{error}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', width: '100%', marginTop: '0.5rem' }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'var(--accent-rose)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <Trash2 size={16} />
              <span>Delete Now</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
