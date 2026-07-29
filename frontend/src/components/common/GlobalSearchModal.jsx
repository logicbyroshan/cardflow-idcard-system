import React, { useState } from 'react';
import { Search, X, User, School, CreditCard } from 'lucide-react';

export default function GlobalSearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const results = [
    { type: 'Student', title: 'Aarav Sharma (ID #101)', subtitle: 'Class 10-A • Adarsh Public School' },
    { type: 'School', title: 'St. Mary International School', subtitle: '4 tables • 320 cards' },
  ];

  return (
    <div className="drawer-overlay" style={{ alignItems: 'flex-start', paddingTop: '10vh' }} onClick={onClose}>
      <div
        className="data-card"
        style={{ width: '580px', maxWidth: '92vw', padding: '1.25rem', backdropFilter: 'blur(16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
          <Search size={20} color="var(--text-muted)" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search cards, clients, tables, or phone numbers..."
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '1rem', outline: 'none' }}
          />
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
          {results.map((res, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(15, 23, 42, 0.4)',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {res.type === 'Student' ? <User size={16} color="#818cf8" /> : <School size={16} color="#34d399" />}
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{res.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{res.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
