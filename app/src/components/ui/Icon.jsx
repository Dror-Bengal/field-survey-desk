// Line-style icon set, 1.5px stroke, currentColor.

export function Icon({ name, size = 16, ...rest }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
    ...rest,
  };
  switch (name) {
    case 'search':        return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>;
    case 'chevron-right': return <svg {...props}><path d="M9 5l7 7-7 7"/></svg>;
    case 'chevron-left':  return <svg {...props}><path d="M15 5l-7 7 7 7"/></svg>;
    case 'chevron-down':  return <svg {...props}><path d="M5 9l7 7 7-7"/></svg>;
    case 'plus':          return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'check':         return <svg {...props}><path d="M5 12l5 5L20 7"/></svg>;
    case 'x':             return <svg {...props}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'gps':           return <svg {...props}><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>;
    case 'phone':         return <svg {...props}><path d="M5 4h4l2 5-2 1a11 11 0 005 5l1-2 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>;
    case 'user':          return <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>;
    case 'home':          return <svg {...props}><path d="M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2z"/></svg>;
    case 'list':          return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case 'clock':         return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'pin':           return <svg {...props}><path d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>;
    case 'wifi':          return <svg {...props}><path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>;
    case 'wifi-off':      return <svg {...props}><path d="M3 3l18 18M9 17a3 3 0 014 0M5 12a10 10 0 0112-2"/></svg>;
    case 'arrow-up':      return <svg {...props}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case 'arrow-right':   return <svg {...props}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case 'filter':        return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>;
    case 'download':      return <svg {...props}><path d="M12 3v12M6 11l6 6 6-6M5 21h14"/></svg>;
    case 'flag':          return <svg {...props}><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>;
    case 'shield':        return <svg {...props}><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/></svg>;
    case 'menu':          return <svg {...props}><path d="M4 6h16M4 12h16M4 18h16"/></svg>;
    case 'logout':        return <svg {...props}><path d="M16 17l5-5-5-5M21 12H9M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4"/></svg>;
    case 'settings':      return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case 'building':      return <svg {...props}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-4h4v4"/></svg>;
    case 'users':         return <svg {...props}><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="3"/><path d="M15 14c3 0 6 2 6 5"/></svg>;
    case 'chart':         return <svg {...props}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>;
    case 'map':           return <svg {...props}><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>;
    default: return null;
  }
}
