export function PhoneFrame({ children, width = 390, height = 820 }) {
  return (
    <div style={{
      width, height, borderRadius: 36, overflow: 'hidden',
      background: 'var(--surface)',
      boxShadow: 'var(--shadow-lg), 0 0 0 8px oklch(0.18 0.012 220), 0 0 0 9px oklch(0.30 0.014 220)',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
      isolation: 'isolate',
    }}>
      {children}
    </div>
  );
}
