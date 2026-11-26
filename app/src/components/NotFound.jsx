// Last-resort route. Stays tiny; we don't expect anyone to hit it because
// /admin and / are the only marketed entry points.
export function NotFound({ lang }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>
      <div style={{
        textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12,
        maxWidth: 360,
      }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--text-3)' }}>404</div>
        <div style={{ fontSize: 16, color: 'var(--text)' }}>
          {('Page not found')}
        </div>
        {/* Plain anchor — full navigation is fine here, no router state to keep. */}
        <a href="/" style={{
          display: 'inline-block', marginTop: 8, color: 'var(--accent)',
          textDecoration: 'none', fontWeight: 500, fontSize: 14,
        }}>
          {('← Go home')}
        </a>
      </div>
    </div>
  );
}
