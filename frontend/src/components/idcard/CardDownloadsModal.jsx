import React, { useState } from 'react';
import { X, Download, FileSpreadsheet, FileText, Archive, Printer, Image as ImageIcon } from 'lucide-react';

export default function CardDownloadsModal({ isOpen, onClose }) {
  const [format, setFormat] = useState('excel');
  const [photoColumn, setPhotoColumn] = useState('PHOTO');

  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" style={{ alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div
        className="data-card"
        style={{ width: '520px', maxWidth: '92vw', padding: '1.75rem', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-md)', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Download size={22} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Download / Export Cards</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Select export format and print settings</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Export Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {[
                { id: 'excel', label: 'Excel Data (.xlsx)', icon: FileSpreadsheet },
                { id: 'pdf', label: 'PDF Cards Sheet', icon: FileText },
                { id: 'zip', label: 'ZIP Photos Only', icon: ImageIcon },
                { id: 'pdf_zip', label: 'ZIP (PDF per photo)', icon: FileText },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = format === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setFormat(opt.id)}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                      border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      color: active ? '#818cf8' : 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={18} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Select Photo Field Column
            </label>
            <select
              value={photoColumn}
              onChange={(e) => setPhotoColumn(e.target.value)}
              style={{ width: '100%', padding: '0.65rem 1rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="PHOTO" style={{ background: '#1e293b' }}>PHOTO (Main Photo)</option>
              <option value="FATHER_PHOTO" style={{ background: '#1e293b' }}>FATHER_PHOTO</option>
            </select>
          </div>

          <button
            onClick={() => { alert(`Generating ${format} export...`); onClose(); }}
            style={{
              width: '100%',
              padding: '0.8rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-emerald)',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              marginTop: '0.5rem',
            }}
          >
            <Download size={18} />
            <span>Generate & Download</span>
          </button>
        </div>
      </div>
    </div>
  );
}
