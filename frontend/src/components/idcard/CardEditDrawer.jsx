import React, { useState } from 'react';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';
import ImageUploadSlot from './ImageUploadSlot';
import { cardApi } from '../../services/api';

export default function CardEditDrawer({ card, onClose, onSave, addToast }) {
  const [formData, setFormData] = useState(card?.field_data || {
    'NAME': card?.name || 'Student Name',
    'FATHER_NAME': 'Father Name',
    'CLASS': '10th',
    'SECTION': 'A',
    'ROLL_NO': '101',
    'MOBILE': '9876543210',
    'PHOTO': card?.photo || ''
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Track original values to only send changed fields
  const original = card?.field_data || {};

  const handleChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
    setSaveError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!card?.id) {
      if (onSave) onSave({ ...card, field_data: formData });
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const errors = [];
    // Save each changed field via API
    for (const [fieldName, value] of Object.entries(formData)) {
      if (String(value ?? '') !== String(original[fieldName] ?? '')) {
        try {
          await cardApi.updateField(card.id, fieldName, value);
        } catch (err) {
          errors.push(fieldName);
          console.warn(`Failed to save field ${fieldName}:`, err);
        }
      }
    }
    setSaving(false);
    if (errors.length > 0) {
      setSaveError(`Some fields could not be saved: ${errors.join(', ')}`);
      addToast?.(`Partial save — ${errors.length} field(s) failed`, 'warning');
    } else {
      addToast?.('Card details saved successfully', 'success');
      if (onSave) onSave({ ...card, field_data: formData });
      onClose();
    }
  };

  return (
    <div className="drawer-overlay" onClick={saving ? undefined : onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Card Details #{card?.id || 'New'}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID Card Field Editor &amp; Image History</span>
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

          {saveError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
              <AlertCircle size={14} />
              <span>{saveError}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 2,
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-primary)',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                opacity: saving ? 0.8 : 1,
              }}
            >
              {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={18} />}
              <span>{saving ? 'Saving...' : 'Save Card Details'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
