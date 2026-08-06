import React, { useState, useEffect, useRef } from 'react';
import { Upload, RotateCcw, RotateCw, Trash2, Image as ImageIcon, Check } from 'lucide-react';
import { cardApi } from '../../services/api';

export default function ImageUploadSlot({ cardId, fieldName, currentPath, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [imagePath, setImagePath] = useState(currentPath || '');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setImagePath(currentPath || '');
  }, [currentPath]);

  const updatePath = (newPath) => {
    setImagePath(newPath);
    if (onUpdate) onUpdate(fieldName, newPath);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (dataUrl) {
        updatePath(dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemove = () => {
    updatePath('');
  };

  const handleUndo = async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res = await cardApi.undoImage(cardId, fieldName);
      if (res?.success && res?.restored_path) {
        updatePath(res.restored_path);
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
        updatePath(res.restored_path);
      }
    } catch (err) {
      console.error('Error redoing image:', err);
    } finally {
      setLoading(false);
    }
  };

  const isSig = (fieldName || '').toLowerCase().includes('sign');
  const isQr = (fieldName || '').toLowerCase().includes('qr');
  const thumbW = isSig ? '95px' : '65px';
  const thumbH = isSig ? '45px' : isQr ? '65px' : '75px';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px 12px',
      border: '1px solid #cbd5e1',
      borderRadius: '6px',
      background: '#f8fafc',
      width: '100%',
      boxSizing: 'border-box',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)'
    }}>
      {/* Header Row: Field Name & Status Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {fieldName}
        </span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: imagePath ? '#16a34a' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px' }}>
          {imagePath ? <><Check size={11} /> Loaded</> : 'Empty'}
        </span>
      </div>

      {/* Main Row: Thumbnail + Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Thumbnail Preview */}
        <div style={{
          width: thumbW,
          height: thumbH,
          minWidth: thumbW,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '4px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)'
        }}>
          {imagePath ? (
            <img
              src={String(imagePath).startsWith('http') || String(imagePath).startsWith('data:') ? imagePath : `/${imagePath}`}
              alt={fieldName}
              style={{ width: '100%', height: '100%', objectFit: isSig || isQr ? 'contain' : 'cover' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <ImageIcon size={20} style={{ color: '#cbd5e1' }} />
          )}
        </div>

        {/* Action Buttons Column / Row */}
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', minWidth: 0 }}>
          {/* Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="img-slot-btn img-slot-upload-btn"
            title="Upload photo from device"
          >
            <Upload size={11} />
            <span>Upload</span>
          </button>

          {/* Undo Button */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={loading || !cardId}
            className="img-slot-btn"
            title="Undo image version"
          >
            <RotateCcw size={11} />
            <span>Undo</span>
          </button>

          {/* Redo Button */}
          <button
            type="button"
            onClick={handleRedo}
            disabled={loading || !cardId}
            className="img-slot-btn"
            title="Redo image version"
          >
            <RotateCw size={11} />
            <span>Redo</span>
          </button>

          {/* Remove Button */}
          {!!imagePath && (
            <button
              type="button"
              onClick={handleRemove}
              className="img-slot-btn img-slot-remove-btn"
              title="Remove image"
            >
              <Trash2 size={11} />
              <span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Row: Full-width Image Path Input */}
      <div style={{ width: '100%', marginTop: '2px' }}>
        <input
          type="text"
          className="img-slot-path-input"
          value={imagePath}
          placeholder="Enter image filename or path..."
          onChange={(e) => updatePath(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
