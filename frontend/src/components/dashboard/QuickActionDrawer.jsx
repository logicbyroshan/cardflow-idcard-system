import React, { useState, useEffect } from 'react';
import {
  X, UserPlus, Building, Mail, Send, Shield, User, Cog, List, RefreshCw, Plus, Search, Eye, EyeOff, Camera, Link, Save, Layers, CheckSquare
} from 'lucide-react';
import { clientApi, operatorApi, assistantApi, photographerApi } from '../../services/api';

/* ─────────────────────────────────────────────────────────────────────────
   Custom Toggle Switch Component matching original UI toggle-slider
───────────────────────────────────────────────────────────────────────── */
function ToggleSwitch({ checked, onChange, isHeader = false }) {
  return (
    <label style={{
      position: 'relative',
      display: 'inline-block',
      width: '38px',
      height: '20px',
      flexShrink: 0,
      cursor: 'pointer',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0 }}
      />
      <span style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: isHeader
          ? (checked ? '#ffffff' : 'rgba(255, 255, 255, 0.35)')
          : (checked ? '#2563eb' : '#cbd5e1'),
        borderRadius: '20px',
        transition: 'background-color 0.2s ease',
        border: isHeader ? '1px solid rgba(255, 255, 255, 0.4)' : 'none',
      }}>
        <span style={{
          position: 'absolute',
          content: '""',
          height: '14px',
          width: '14px',
          left: '3px',
          bottom: '3px',
          backgroundColor: isHeader ? (checked ? '#2563eb' : '#ffffff') : '#ffffff',
          borderRadius: '50%',
          transition: 'transform 0.2s ease',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </span>
    </label>
  );
}

export default function QuickActionDrawer({ isOpen, actionType, onClose, addToast }) {
  if (!isOpen || !actionType) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(1px)',
          zIndex: 1040,
          animation: 'fadeIn 0.15s ease-out',
        }}
      />

      {/* Slide-over Drawer Container */}
      <div
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: actionType === 'message' ? '760px' : '540px',
          maxWidth: '95vw',
          height: '100vh',
          background: '#ffffff',
          boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.2)',
          zIndex: 1050,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideLeft 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {actionType === 'add-client' && (
          <OriginalClientDrawerForm onClose={onClose} addToast={addToast} />
        )}
        {(actionType === 'add-operator' || actionType === 'add-staff') && (
          <OriginalOperatorDrawerForm onClose={onClose} addToast={addToast} />
        )}
        {actionType === 'assign-operator' && (
          <AssignOperatorOrganisationsForm onClose={onClose} addToast={addToast} />
        )}
        {actionType === 'add-assistant' && (
          <OriginalAssistantDrawerForm onClose={onClose} addToast={addToast} />
        )}
        {actionType === 'assign-assistant' && (
          <AssignAssistantGroupsForm onClose={onClose} addToast={addToast} />
        )}
        {actionType === 'add-photographer' && (
          <OriginalPhotographerDrawerForm onClose={onClose} addToast={addToast} />
        )}
        {actionType === 'message' && (
          <OriginalMessageDrawerForm onClose={onClose} addToast={addToast} />
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideLeft {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   1. Add New Organisation Drawer
───────────────────────────────────────────────────────────────────────── */
function OriginalClientDrawerForm({ onClose, addToast }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    status: 'false',
    passwordOption: 'custom',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const [groupPerms, setGroupPerms] = useState({
    add: true, edit: true, list: true, delete: true, status: true,
  });

  const [actionPerms, setActionPerms] = useState({
    pending: true, verified: true, pool: true, approved: true, download: true,
  });

  const [reprintPerms, setReprintPerms] = useState({
    reprint_pending: true, reprint_confirmed: true,
    card_add: true, card_edit: true, card_verify: true, card_approve: true,
  });

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email) {
      addToast?.('Please fill in Name and Email address', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        status: formData.status === 'true' ? 'active' : 'inactive',
        password_option: formData.passwordOption,
        password: formData.passwordOption === 'custom' ? formData.password : undefined,
        permissions: { ...groupPerms, ...actionPerms, ...reprintPerms },
      };
      const res = await clientApi.createClient(payload);
      if (res.success !== false) {
        addToast?.(`Organisation "${formData.name}" created successfully!`, 'success');
        onClose();
      } else {
        addToast?.(res.message || res.error || 'Failed to create organisation', 'error');
      }
    } catch (err) {
      addToast?.('Error creating organisation', 'error');
    } finally {
      setSaving(false);
    }
  };


  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      
      {/* 1. Header (Fixed Top) */}
      <div style={{
        background: '#2563eb',
        color: '#fff',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <UserPlus size={18} />
          <span>Add New Organisation</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* 2. Scrollable Body Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        
        {/* Section 1: Organisation Information */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px'
          }}>
            <Building size={15} /> Organisation Information
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                Organisation Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter organisation / school name"
                style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Email <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter email address"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Enter phone number (optional)"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="false">Inactive</option>
                  <option value="true">Active</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Password Option</label>
                <select
                  value={formData.passwordOption}
                  onChange={(e) => setFormData({ ...formData, passwordOption: e.target.value })}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="custom">Custom Password</option>
                  <option value="phone">Use Phone Number</option>
                </select>
              </div>
            </div>

            {formData.passwordOption === 'custom' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter custom password"
                    style={{ width: '100%', height: '36px', padding: '0 36px 0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: '#6b7280', cursor: 'pointer' }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: User Permission */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px'
          }}>
            <Shield size={15} /> User Permission
          </div>

          {/* Category 1: GROUP SETTINGS */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cog size={13} /> TABLE SETTINGS
              </div>
              <ToggleSwitch
                checked={Object.values(groupPerms).every(Boolean)}
                onChange={(val) => {
                  setGroupPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'add', label: 'Create Template' },
                { key: 'edit', label: 'Edit Template' },
                { key: 'list', label: 'View Template' },
                { key: 'delete', label: 'Delete Template' },
                { key: 'status', label: 'Status Template' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!groupPerms[key]}
                    onChange={(v) => setGroupPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 2: ID CARD ACTION LIST */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <List size={13} /> ID CARD ACTION LIST
              </div>
              <ToggleSwitch
                checked={Object.values(actionPerms).every(Boolean)}
                onChange={(val) => {
                  setActionPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'pending', label: 'Pending List' },
                { key: 'verified', label: 'Verified List' },
                { key: 'pool', label: 'Pool List' },
                { key: 'approved', label: 'Approved List' },
                { key: 'download', label: 'Download List' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!actionPerms[key]}
                    onChange={(v) => setActionPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 3: REPRINT & CARD ACTIONS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={13} /> REPRINT & CARD ACTIONS
              </div>
              <ToggleSwitch
                checked={Object.values(reprintPerms).every(Boolean)}
                onChange={(val) => {
                  setReprintPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'reprint_pending', label: 'Reprint Request' },
                { key: 'reprint_confirmed', label: 'Confirmed List' },
                { key: 'card_add', label: 'Add Card' },
                { key: 'card_edit', label: 'Edit Card' },
                { key: 'card_verify', label: 'Verify Card' },
                { key: 'card_approve', label: 'Approve Card' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!reprintPerms[key]}
                    onChange={(v) => setReprintPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. STICKY FOOTER */}
      <div style={{
        flexShrink: 0,
        padding: '12px 18px',
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
        boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
        zIndex: 10,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            color: '#2563eb',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            background: '#2563eb',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={14} /> {saving ? 'Adding…' : '+ Add Organisation'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Add New Operator Drawer (OPERATOR INFO + PERMISSIONS)
───────────────────────────────────────────────────────────────────────── */
function OriginalOperatorDrawerForm({ onClose, addToast }) {
  const [operatorName, setOperatorName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('false');
  const [passwordOption, setPasswordOption] = useState('custom');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [groupPerms, setGroupPerms] = useState({
    add: true, edit: true, list: true, delete: true, status: true,
  });

  const [actionPerms, setActionPerms] = useState({
    pending: true, verified: true, pool: true, approved: true, download: true,
  });

  const [reprintPerms, setReprintPerms] = useState({
    reprint_pending: true, reprint_confirmed: true,
    card_add: true, card_edit: true, card_verify: true, card_approve: true,
  });

  const [saving, setSaving] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!operatorName || !email) {
      addToast?.('Please fill in Operator Name and Email', 'warning');
      return;
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      addToast?.(`Operator "${operatorName}" created successfully! Use 'Assign' button to assign organisations.`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      
      {/* 1. Header (Fixed Top) */}
      <div style={{
        background: '#2563eb',
        color: '#fff',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <UserPlus size={18} />
          <span>Add New Operator</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* 2. Scrollable Body Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        
        {/* Section 1: Operator Information */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <User size={15} /> Operator Information
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                Operator Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="Enter operator name"
                style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Email <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email address"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone number (optional)"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="false">Inactive</option>
                  <option value="true">Active</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Password Option</label>
                <select
                  value={passwordOption}
                  onChange={(e) => setPasswordOption(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="custom">Custom Password</option>
                  <option value="phone">Use Phone Number</option>
                </select>
              </div>
            </div>

            {passwordOption === 'custom' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter custom password"
                    style={{ width: '100%', height: '36px', padding: '0 36px 0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: '#6b7280', cursor: 'pointer' }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Operator Permissions */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px'
          }}>
            <Shield size={15} /> Operator Permissions
          </div>

          {/* Category 1: GROUP SETTINGS */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cog size={13} /> TABLE SETTINGS
              </div>
              <ToggleSwitch
                checked={Object.values(groupPerms).every(Boolean)}
                onChange={(val) => {
                  setGroupPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'add', label: 'Create Template' },
                { key: 'edit', label: 'Edit Template' },
                { key: 'list', label: 'View Template' },
                { key: 'delete', label: 'Delete Template' },
                { key: 'status', label: 'Status Template' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!groupPerms[key]}
                    onChange={(v) => setGroupPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 2: ID CARD ACTION LIST */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <List size={13} /> ID CARD ACTION LIST
              </div>
              <ToggleSwitch
                checked={Object.values(actionPerms).every(Boolean)}
                onChange={(val) => {
                  setActionPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'pending', label: 'Pending List' },
                { key: 'verified', label: 'Verified List' },
                { key: 'pool', label: 'Pool List' },
                { key: 'approved', label: 'Approved List' },
                { key: 'download', label: 'Download List' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!actionPerms[key]}
                    onChange={(v) => setActionPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 3: REPRINT & CARD ACTIONS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={13} /> REPRINT & CARD ACTIONS
              </div>
              <ToggleSwitch
                checked={Object.values(reprintPerms).every(Boolean)}
                onChange={(val) => {
                  setReprintPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'reprint_pending', label: 'Reprint Request' },
                { key: 'reprint_confirmed', label: 'Confirmed List' },
                { key: 'card_add', label: 'Add Card' },
                { key: 'card_edit', label: 'Edit Card' },
                { key: 'card_verify', label: 'Verify Card' },
                { key: 'card_approve', label: 'Approve Card' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!reprintPerms[key]}
                    onChange={(v) => setReprintPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. STICKY FOOTER */}
      <div style={{
        flexShrink: 0,
        padding: '12px 18px',
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
        boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
        zIndex: 10,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            color: '#2563eb',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            background: '#2563eb',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={14} /> {saving ? 'Creating…' : '+ Add Operator'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   2b. Assign Organisations to Operator Drawer ('assign-operator')
───────────────────────────────────────────────────────────────────────── */
function AssignOperatorOrganisationsForm({ onClose, addToast }) {
  const [search, setSearch] = useState('');
  const [selectedClients, setSelectedClients] = useState(['1', '2', '3']);
  const [saving, setSaving] = useState(false);

  const allClients = [
    { id: '1', name: 'SAKET MGM SCHOOL (VIDISHA)' },
    { id: '2', name: 'MAHARSHI VASHISHTA VIDYA NIKETAN' },
    { id: '3', name: 'DM CO ED SCHOOL (BHOPAL)' },
    { id: '4', name: 'CANYON SCHOOL' },
    { id: '5', name: 'RIVERTON VALLEY SCHOOL' },
    { id: '6', name: 'DPS (NEELBAD)' },
    { id: '7', name: 'ANAND VIDYA MANDIR' },
    { id: '8', name: 'ST MARYS CONVENT SR SEC SCHOOL' },
  ];

  const filteredClients = allClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const toggleSelectAll = () => {
    if (selectedClients.length === filteredClients.length) {
      setSelectedClients([]);
    } else {
      setSelectedClients(filteredClients.map(c => c.id));
    }
  };

  const toggleClient = (id) => {
    setSelectedClients(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      addToast?.(`Assigned ${selectedClients.length} organisation(s) to operator successfully!`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      <div style={{ background: '#2563eb', color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <Link size={18} />
          <span>Assign Organisations to Operator</span>
        </div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        <div>
          <div style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building size={15} /> Select Assigned Organisations ({selectedClients.length})
            </div>
            <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
              <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Select All</button>
              <button type="button" onClick={() => setSelectedClients([])} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#f8fafc' }}>
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organisation school..."
                style={{ width: '100%', height: '32px', paddingLeft: '30px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
              />
            </div>

            <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredClients.map(c => {
                const isChecked = selectedClients.includes(c.id);
                return (
                  <label
                    key={c.id}
                    onClick={() => toggleClient(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', borderRadius: '6px', border: '1px solid',
                      borderColor: isChecked ? '#bfdbfe' : '#e2e8f0',
                      background: isChecked ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer', fontSize: '13px', color: '#334155', fontWeight: 500
                    }}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => {}} style={{ accentColor: '#2563eb' }} />
                    <span>{c.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '12px 18px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#2563eb', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
          <X size={14} /> Cancel
        </button>
        <button type="submit" disabled={saving} style={{ padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: '4px', color: '#ffffff', fontWeight: 700, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save Assignments'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Add New Assistant Drawer (SINGLE CLIENT SELECTION + ASSISTANT DETAILS + PERMISSIONS)
───────────────────────────────────────────────────────────────────────── */
function OriginalAssistantDrawerForm({ onClose, addToast }) {
  const [selectedClient, setSelectedClient] = useState('1');
  const [assistantName, setAssistantName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('false');
  const [passwordOption, setPasswordOption] = useState('custom');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [groupPerms, setGroupPerms] = useState({
    add: true, edit: true, list: true, delete: true, status: true,
  });

  const [actionPerms, setActionPerms] = useState({
    pending: true, verified: true, pool: true, approved: true, download: true,
  });

  const [reprintPerms, setReprintPerms] = useState({
    reprint_pending: true, reprint_confirmed: true,
    card_add: true, card_edit: true, card_verify: true, card_approve: true,
  });

  const allClients = [
    { id: '1', name: 'SAKET MGM SCHOOL (VIDISHA)' },
    { id: '2', name: 'MAHARSHI VASHISHTA VIDYA NIKETAN' },
    { id: '3', name: 'DM CO ED SCHOOL (BHOPAL)' },
    { id: '4', name: 'CANYON SCHOOL' },
    { id: '5', name: 'RIVERTON VALLEY SCHOOL' },
    { id: '6', name: 'DPS (NEELBAD)' },
    { id: '7', name: 'ANAND VIDYA MANDIR' },
    { id: '8', name: 'ST MARYS CONVENT SR SEC SCHOOL' },
  ];

  const [saving, setSaving] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!assistantName || !email) {
      addToast?.('Please fill in Assistant Name and Email', 'warning');
      return;
    }
    const targetOrg = allClients.find(c => c.id === selectedClient)?.name || 'Selected Organisation';
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      addToast?.(`Assistant "${assistantName}" created for ${targetOrg}!`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      
      {/* 1. Header (Fixed Top) */}
      <div style={{
        background: '#2563eb',
        color: '#fff',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <UserPlus size={18} />
          <span>Add New Assistant</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* 2. Scrollable Body Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        
        {/* Section 1: Organisation Selection (Pick 1 Client) */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <Building size={15} /> Select Organisation
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Select Organisation / Client to which this Assistant is created for <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#1e293b',
                outline: 'none',
                fontFamily: 'var(--font-family)',
                background: '#f8fafc',
                cursor: 'pointer'
              }}
            >
              {allClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Section 2: Assistant Information */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <User size={15} /> Assistant Information
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                Assistant Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={assistantName}
                onChange={(e) => setAssistantName(e.target.value)}
                placeholder="Enter assistant name"
                style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Email <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email address"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone number (optional)"
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="false">Inactive</option>
                  <option value="true">Active</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Password Option</label>
                <select
                  value={passwordOption}
                  onChange={(e) => setPasswordOption(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
                >
                  <option value="custom">Custom Password</option>
                  <option value="phone">Use Phone Number</option>
                </select>
              </div>
            </div>

            {passwordOption === 'custom' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter custom password"
                    style={{ width: '100%', height: '36px', padding: '0 36px 0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: '#6b7280', cursor: 'pointer' }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Assistant Permissions */}
        <div>
          <div style={{
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px'
          }}>
            <Shield size={15} /> Assistant Permissions
          </div>

          {/* Category 1: GROUP SETTINGS */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cog size={13} /> TABLE SETTINGS
              </div>
              <ToggleSwitch
                checked={Object.values(groupPerms).every(Boolean)}
                onChange={(val) => {
                  setGroupPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'add', label: 'Create Template' },
                { key: 'edit', label: 'Edit Template' },
                { key: 'list', label: 'View Template' },
                { key: 'delete', label: 'Delete Template' },
                { key: 'status', label: 'Status Template' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!groupPerms[key]}
                    onChange={(v) => setGroupPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 2: ID CARD ACTION LIST */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <List size={13} /> ID CARD ACTION LIST
              </div>
              <ToggleSwitch
                checked={Object.values(actionPerms).every(Boolean)}
                onChange={(val) => {
                  setActionPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'pending', label: 'Pending List' },
                { key: 'verified', label: 'Verified List' },
                { key: 'pool', label: 'Pool List' },
                { key: 'approved', label: 'Approved List' },
                { key: 'download', label: 'Download List' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!actionPerms[key]}
                    onChange={(v) => setActionPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category 3: REPRINT & CARD ACTIONS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#1e3a8a', letterSpacing: '0.04em', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={13} /> REPRINT & CARD ACTIONS
              </div>
              <ToggleSwitch
                checked={Object.values(reprintPerms).every(Boolean)}
                onChange={(val) => {
                  setReprintPerms(prev => {
                    const copy = { ...prev };
                    Object.keys(copy).forEach(k => { copy[k] = val; });
                    return copy;
                  });
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {[
                { key: 'reprint_pending', label: 'Reprint Request' },
                { key: 'reprint_confirmed', label: 'Confirmed List' },
                { key: 'card_add', label: 'Add Card' },
                { key: 'card_edit', label: 'Edit Card' },
                { key: 'card_verify', label: 'Verify Card' },
                { key: 'card_approve', label: 'Approve Card' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <ToggleSwitch
                    checked={!!reprintPerms[key]}
                    onChange={(v) => setReprintPerms(prev => ({ ...prev, [key]: v }))}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. STICKY FOOTER */}
      <div style={{
        flexShrink: 0,
        padding: '12px 18px',
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
        boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
        zIndex: 10,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            color: '#2563eb',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            background: '#2563eb',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={14} /> {saving ? 'Creating…' : '+ Add Assistant'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   3b. Assign Groups / Classes to Assistant Drawer ('assign-assistant')
───────────────────────────────────────────────────────────────────────── */
function AssignAssistantGroupsForm({ onClose, addToast }) {
  const [search, setSearch] = useState('');
  const [selectedGroups, setSelectedGroups] = useState(['1', '2']);
  const [saving, setSaving] = useState(false);

  const groups = [
    { id: '1', name: 'CLASS 1 - SEC A' },
    { id: '2', name: 'CLASS 1 - SEC B' },
    { id: '3', name: 'CLASS 2 - SEC A' },
    { id: '4', name: 'CLASS 3 - SEC A' },
    { id: '5', name: 'STAFF & TEACHERS' },
  ];

  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  const toggleGroup = (id) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      addToast?.(`Assigned ${selectedGroups.length} group(s) to assistant successfully!`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      <div style={{ background: '#2563eb', color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <Layers size={18} />
          <span>Assign Groups & Classes to Assistant</span>
        </div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        <div>
          <div style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={15} /> Select Classes / Groups ({selectedGroups.length})
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#f8fafc' }}>
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search class or group..."
                style={{ width: '100%', height: '32px', paddingLeft: '30px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
              />
            </div>

            <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredGroups.map(g => {
                const isChecked = selectedGroups.includes(g.id);
                return (
                  <label
                    key={g.id}
                    onClick={() => toggleGroup(g.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', borderRadius: '6px', border: '1px solid',
                      borderColor: isChecked ? '#bfdbfe' : '#e2e8f0',
                      background: isChecked ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer', fontSize: '13px', color: '#334155', fontWeight: 500
                    }}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => {}} style={{ accentColor: '#2563eb' }} />
                    <span>{g.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '12px 18px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#2563eb', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
          <X size={14} /> Cancel
        </button>
        <button type="submit" disabled={saving} style={{ padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: '4px', color: '#ffffff', fontWeight: 700, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save Group Assignments'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   4. Add New Photographer Drawer
───────────────────────────────────────────────────────────────────────── */
function OriginalPhotographerDrawerForm({ onClose, addToast }) {
  const [search, setSearch] = useState('');
  const [selectedClients, setSelectedClients] = useState(['1', '2']);
  const [photographerName, setPhotographerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('false');
  const [password, setPassword] = useState('');

  const allClients = [
    { id: '1', name: 'SAKET MGM SCHOOL (VIDISHA)' },
    { id: '2', name: 'MAHARSHI VASHISHTA VIDYA NIKETAN' },
    { id: '3', name: 'DM CO ED SCHOOL (BHOPAL)' },
    { id: '4', name: 'CANYON SCHOOL' },
  ];

  const filteredClients = allClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!photographerName || !email) {
      addToast?.('Please fill in Photographer Name and Email', 'warning');
      return;
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      addToast?.(`Photographer "${photographerName}" created successfully!`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      <div style={{ background: '#2563eb', color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <Camera size={18} />
          <span>Add New Photographer</span>
        </div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff' }}>
        <div>
          <div style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Building size={15} /> Assigned Organisations ({selectedClients.length})
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', background: '#f8fafc' }}>
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organisation school..."
                style={{ width: '100%', height: '28px', paddingLeft: '26px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', outline: 'none' }}
              />
            </div>
            <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {filteredClients.map(c => {
                const isChecked = selectedClients.includes(c.id);
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '4px', border: '1px solid', borderColor: isChecked ? '#bfdbfe' : '#e2e8f0', background: isChecked ? '#eff6ff' : '#ffffff', cursor: 'pointer', fontSize: '12px' }}>
                    <input type="checkbox" checked={isChecked} onChange={() => setSelectedClients(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])} style={{ accentColor: '#2563eb' }} />
                    <span>{c.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <User size={15} /> Photographer Information
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Photographer Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="text" required value={photographerName} onChange={(e) => setPhotographerName(e.target.value)} placeholder="Enter photographer name" style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Email <span style={{ color: '#ef4444' }}>*</span></label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Phone</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone" style={{ width: '100%', height: '36px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', outline: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '12px 18px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#2563eb', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}><X size={14} /> Cancel</button>
        <button type="submit" disabled={saving} style={{ padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: '4px', color: '#ffffff', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}><Plus size={14} /> {saving ? 'Creating…' : '+ Add Photographer'}</button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   5. Adarsh Messenger Broadcast Drawer
───────────────────────────────────────────────────────────────────────── */
function OriginalMessageDrawerForm({ onClose, addToast }) {
  const [search, setSearch] = useState('');
  const [selectedClients, setSelectedClients] = useState(['1', '2', '3', '4', '5']);
  const [visibility, setVisibility] = useState('permanent');
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);

  const clientList = [
    { id: '1', name: 'SAKET MGM SCHOOL (VIDISHA)', isLive: true },
    { id: '2', name: 'MAHARSHI VASHISHTA VIDYA NIKETAN', isLive: false },
    { id: '3', name: 'DM CO ED SCHOOL (BHOPAL)', isLive: false },
    { id: '4', name: 'CANYON SCHOOL', isLive: true },
    { id: '5', name: 'RIVERTON VALLEY SCHOOL', isLive: false },
    { id: '6', name: 'ST MARYS CONVENT SR SEC SCHOOL', isLive: true },
    { id: '7', name: 'DPS (NEELBAD)', isLive: false },
    { id: '8', name: 'ANAND VIDYA MANDIR', isLive: false },
  ];

  const filtered = clientList.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const toggleSelectAll = () => {
    if (selectedClients.length === filtered.length) {
      setSelectedClients([]);
    } else {
      setSelectedClients(filtered.map(c => c.id));
    }
  };

  const toggleSingle = (id) => {
    setSelectedClients(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!msgText.trim()) {
      addToast?.('Please type a broadcast message text', 'warning');
      return;
    }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      addToast?.(`Message broadcasted to ${selectedClients.length} recipients!`, 'success');
      onClose();
    }, 600);
  };

  return (
    <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      
      {/* 1. Header (Fixed Top) */}
      <div style={{
        background: '#2563eb',
        color: '#fff',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
          <Mail size={18} />
          <span>Adarsh Messenger Broadcast</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* 2. Scrollable Dual Panel Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', background: '#f8fafc', minHeight: 0 }}>
        
        {/* Left Panel: Client Selector */}
        <div style={{ width: '320px', borderRight: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>Recipients ({selectedClients.length})</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Select All</button>
                <button type="button" onClick={() => setSelectedClients([])} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Clear</button>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organisation school..."
                style={{ width: '100%', height: '28px', paddingLeft: '26px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', outline: 'none' }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filtered.map(c => {
              const isChecked = selectedClients.includes(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => toggleSingle(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: '6px', border: '1px solid',
                    borderColor: isChecked ? '#bfdbfe' : '#e2e8f0',
                    background: isChecked ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <input type="checkbox" checked={isChecked} onChange={() => {}} style={{ accentColor: '#2563eb' }} />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  </div>
                  {c.isLive && (
                    <span style={{ fontSize: '9px', fontWeight: 700, background: '#d1fae5', color: '#047857', padding: '1px 5px', borderRadius: '2px', flexShrink: 0 }}>Live</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Composer & History */}
        <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0, overflowY: 'auto', background: '#ffffff' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Message Type / Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              style={{ width: '100%', height: '34px', padding: '0 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff' }}
            >
              <option value="permanent">Permanent Dashboard Notification Banner</option>
              <option value="temporary_24h">Temporary Banner (Expires in 24 Hours)</option>
              <option value="urgent">Urgent Announcement Modal Alert</option>
            </select>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                Broadcast Message Text <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>{msgText.length} / 500 chars</span>
            </div>
            <textarea
              required
              rows={6}
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Type notification or system announcement to broadcast to organisation dashboards..."
              style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-family)', resize: 'vertical' }}
            />
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', background: '#f8fafc' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#2563eb', marginBottom: '4px' }}>Recent Broadcast Log</div>
            <div style={{ fontSize: '11px', color: '#475569' }}>
              <strong>System Admin:</strong> "All photo corrections for Batch 2026 are completed."
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>Visible to 182 recipients • 2 hours ago</div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. STICKY FOOTER */}
      <div style={{
        flexShrink: 0,
        padding: '12px 18px',
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
        boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
        zIndex: 10,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{ padding: '8px 16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#2563eb', fontWeight: 600, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          disabled={sending}
          style={{ padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: '4px', color: '#ffffff', fontWeight: 700, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Send size={13} />
          <span>{sending ? 'Sending…' : 'Broadcast Message'}</span>
        </button>
      </div>
    </form>
  );
}
