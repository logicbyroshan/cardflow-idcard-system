import React, { useState } from 'react';
import { X, Save, Shield } from 'lucide-react';
import ImageUploadSlot from './ImageUploadSlot';

export default function CardEditDrawer({ card, onClose, onSave }) {
  const [formData, setFormData] = useState(card?.field_data || {
    'NAME': card?.name || 'Student Name',
    'FATHER_NAME': 'Father Name',
    'CLASS': '10th',
    'SECTION': 'A',
    'ROLL_NO': '101',
    'MOBILE': '9876543210',
    'PHOTO': card?.photo || ''
  });

  const handleChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) onSave({ ...card, field_data: formData });
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Card Details #{card?.id || 'New'}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID Card Field Editor & Image History</span>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <ImageUploadSlot
              cardId={card?.id}
              fieldName="PHOTO"
              currentPath={formData.PHOTO}
              onUpdate={(field, path) => handleChange(field, path)}
            />
            <ImageUploadSlot
              cardId={card?.id}
              fieldName="SIGNATURE"
              currentPath={formData.SIGNATURE}
              onUpdate={(field, path) => handleChange(field, path)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Object.entries(formData).map(([key, val]) => {
              if (['PHOTO', 'SIGNATURE', 'BARCODE', 'QR_CODE'].includes(key)) return null;
              return (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                    {key.replace(/_/g, ' ')}
                  </label>
                  <input
                    type="text"
                    value={val || ''}
                    onChange={(e) => handleChange(key, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 1rem',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      outline: 'none',
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 2,
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-primary)',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <Save size={18} />
              <span>Save Card Details</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
