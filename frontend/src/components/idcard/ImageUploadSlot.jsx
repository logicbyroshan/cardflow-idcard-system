import React, { useState } from 'react';
import { Upload, RotateCcw, RotateCw, Image as ImageIcon, Trash2 } from 'lucide-react';
import { cardApi } from '../../services/api';

export default function ImageUploadSlot({ cardId, fieldName, currentPath, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [imagePath, setImagePath] = useState(currentPath || '');

  const handleUndo = async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res = await cardApi.undoCardImage(cardId, fieldName);
      if (res.success && res.restored_path) {
        setImagePath(res.restored_path);
        if (onUpdate) onUpdate(fieldName, res.restored_path);
      } else {
        alert(res.message || 'Undo not available');
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
      const res = await cardApi.redoCardImage(cardId, fieldName);
      if (res.success && res.restored_path) {
        setImagePath(res.restored_path);
        if (onUpdate) onUpdate(fieldName, res.restored_path);
      } else {
        alert(res.message || 'Redo not available');
      }
    } catch (err) {
      console.error('Error redoing image:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="photo-slot-card">
      <div className="photo-preview">
        {imagePath ? (
          <img
            src={`/${imagePath}`}
            alt={fieldName}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-md)' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon size={32} color="var(--text-muted)" />
        )}
      </div>

      <div style={{ width: '100%', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center' }}>
        {fieldName}
      </div>

      <div className="photo-actions">
        <button className="btn-icon-action" onClick={handleUndo} disabled={loading || !cardId} title="Undo Image Version">
          <RotateCcw size={14} />
          <span>Undo</span>
        </button>

        <button className="btn-icon-action" onClick={handleRedo} disabled={loading || !cardId} title="Redo Image Version">
          <RotateCw size={14} />
          <span>Redo</span>
        </button>
      </div>
    </div>
  );
}
