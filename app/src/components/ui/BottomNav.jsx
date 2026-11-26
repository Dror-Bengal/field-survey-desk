import { Icon } from './Icon.jsx';

const ITEMS = [
  { id: 'work',    icon: 'home', label_en: 'Work' },
  { id: 'profile', icon: 'user', label_en: 'Me' },
];

export function BottomNav({ active, onChange, lang }) {
  return (
    <div style={{
      display: 'flex',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface)',
      // Add the iPhone home-bar inset so the nav clears the gesture area.
      // Falls back to 8px on devices without a safe-area inset.
      padding: '6px 4px calc(8px + env(safe-area-inset-bottom, 0px))',
      flexShrink: 0,
    }}>
      {ITEMS.map(it => (
        <button key={it.id} onClick={() => onChange(it.id)}
          className="btn btn-ghost"
          style={{
            flex: 1, flexDirection: 'column', gap: 3, padding: '6px 0',
            color: active === it.id ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 10, fontWeight: 600,
          }}>
          <Icon name={it.icon} size={20} />
          {(it.label_en)}
        </button>
      ))}
    </div>
  );
}
