import React, { useState } from 'react';
import { RotateCcw, RotateCw, Image as ImageIcon } from 'lucide-react';
import { cardApi } from '../../services/api';

export default function ImageUploadSlot({ cardId, fieldName, currentPath, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [imagePath, setImagePath] = useState(currentPath || '');

  const handleUndo = async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res = await cardApi.undoImage(cardId, fieldName);
      if (res?.success && res?.restored_path) {
        setImagePath(res.restored_path);
        if (onUpdate) onUpdate(fieldName, res.restored_path);
      }
    } catch (err) {
      console.error('Error undoing image:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRedo = async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res = await cardApi.redoImage(cardId, fieldName);
      if (res?.success && res?.restored_path) {
        setImagePath(res.restored_path);
        if (onUpdate) onUpdate(fieldName, res.restored_path);
      }
    } catch (err) {
      console.error('Error redoing image:', err);
    } finally {
      setLoading(false);
    }
  };

  const isSig = (fieldName || '').toLowerCase().includes('sign');
  const isQr = (fieldName || '').toLowerCase().includes('qr');
  const slotW = isSig ? '120px' : '85px';
  const slotH = isSig ? '55px' : isQr ? '85px' : '95px';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc', width: '100%', boxSizing: 'border-box' }}>
      {/* Thumbnail Box */}
      <div style={{ width: slotW, height: slotH, minWidth: slotW, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {imagePath ? (
          <img
            src={String(imagePath).startsWith('http') ? imagePath : `/${imagePath}`}
            alt={fieldName}
            style={{ width: '100%', height: '100%', objectFit: isSig || isQr ? 'contain' : 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon size={26} style={{ color: '#cbd5e1' }} />
        )}
      </div>

      {/* Details & Action Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
            {fieldName} Image Slot
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
            {imagePath ? 'Photo loaded' : 'No photo uploaded'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={loading || !cardId}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              cursor: loading || !cardId ? 'not-allowed' : 'pointer',
              opacity: loading || !cardId ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              boxSizing: 'border-box'
            }}
          >
            <RotateCcw size={11} /> Undo
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={loading || !cardId}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              cursor: loading || !cardId ? 'not-allowed' : 'pointer',
              opacity: loading || !cardId ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              boxSizing: 'border-box'
            }}
          >
            <RotateCw size={11} /> Redo
          </button>
        </div>
      </div>
    </div>
  );
}
