import React from 'react';
import { CheckCircle, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

const TYPE_MAP = {
  success: { Icon: CheckCircle,  cls: 'success' },
  error:   { Icon: AlertCircle,  cls: 'error'   },
  warning: { Icon: AlertTriangle,cls: 'warning' },
  info:    { Icon: Info,         cls: 'info'    },
};

export default function ToastNotification({ toasts = [], onCloseToast }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-wrapper">
      {toasts.map((t) => {
        const cfg = TYPE_MAP[t.type] || TYPE_MAP.info;
        const Icon = cfg.Icon;
        return (
          <div key={t.id} className={`toast show ${cfg.cls}`}>
            <Icon size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, lineHeight: 1.4 }}>{t.message}</span>
            <button className="toast-close" onClick={() => onCloseToast(t.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
