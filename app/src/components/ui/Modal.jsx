import { useEffect } from 'react';
import { Icon } from './Icon.jsx';

export function Modal({ open, onClose, title, children, footer, width = 480 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true"
         onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         style={{
           position: 'fixed', inset: 0, zIndex: 100,
           background: 'rgba(15, 23, 33, 0.45)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           padding: 20,
         }}>
      <div style={{
        width: '100%', maxWidth: width,
        background: 'var(--surface)', color: 'var(--text)',
        borderRadius: 14, boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', maxHeight: '85vh',
      }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} className="btn btn-ghost"
                  aria-label="Close" style={{ padding: 6, color: 'var(--text-3)' }}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <footer style={{
            padding: 12, borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}>{footer}</footer>
        )}
      </div>
    </div>
  );
}
