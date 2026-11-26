import { Icon } from './Icon.jsx';

export function AppHeader({ title, subtitle, onBack, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 14px 12px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      {onBack && (
        <button className="btn btn-ghost" onClick={onBack}
                aria-label="Back"
                style={{ padding: 8, borderRadius: 8, marginLeft: -6 }}>
          <Icon name="chevron-left" size={20} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {subtitle && (
          <div style={{
            fontSize: 11, color: 'var(--text-3)',
            textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600,
          }}>{subtitle}</div>
        )}
        <div style={{
          fontSize: 17, fontWeight: 600, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</div>
      </div>
      {action}
    </div>
  );
}
