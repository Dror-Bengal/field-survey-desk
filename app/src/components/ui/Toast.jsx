import { useEffect } from 'react';
import { Icon } from './Icon.jsx';

// Two visual variants:
//   kind='success' → check icon, default dark background
//   kind='error'   → x icon, refused-color background
const VARIANTS = {
  success: { icon: 'check', bg: 'var(--text)',          fg: 'var(--surface)',     ms: 2200 },
  error:   { icon: 'x',     bg: 'var(--st-refused-fg)', fg: 'var(--surface)',     ms: 4500 },
};

export function Toast({ message, kind = 'success', onDone }) {
  useEffect(() => {
    if (!message) return;
    const v = VARIANTS[kind] || VARIANTS.success;
    const id = setTimeout(onDone, v.ms);
    return () => clearTimeout(id);
  }, [message, kind, onDone]);

  if (!message) return null;
  const v = VARIANTS[kind] || VARIANTS.success;

  return (
    <div role="status" aria-live="polite" style={{
      position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: v.bg, color: v.fg,
      padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
      boxShadow: 'var(--shadow-md)', zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 8, maxWidth: '85%',
      lineHeight: 1.35,
    }}>
      <Icon name={v.icon} size={16} />
      <span style={{ overflowWrap: 'anywhere' }}>{message}</span>
    </div>
  );
}
