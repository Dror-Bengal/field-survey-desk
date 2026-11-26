function trimStr(x) {
  return typeof x === 'string' ? x.trim() : '';
}
// alphabetic streets alone. Used by surfaces that show a street alone
// without a house (BrowseStreet group header, list of streets).
export function formatStreetForDisplay(streetRaw, lang = 'en') {
  const s = trimStr(streetRaw);
  if (!s) return '';
  if (/^\d/.test(s)) return `${'St.'} ${s}`;
  return s;
}

// Format a full address line (or any subset of street / modifier / house).
// Returns an empty string when nothing is present so callers can render-or-skip.
export function formatAddressDisplay(street, modifier, house, lang = 'en') {
  const s = trimStr(street);
  const m = trimStr(modifier);
  const h = trimStr(house != null ? String(house) : '');
  const designator = 'St.';

  // Nothing useful to show.
  if (!s && !h) return m;

  let core;
  if (!s) {
    core = `${designator} ${h}`;
  } else if (!h) {
    // Street alone — degenerate to formatStreetForDisplay shape.
    core = /^\d/.test(s) ? `${designator} ${s}` : s;
  } else if (/^\d/.test(s)) {
    // Numeric street: lead with the designator, comma between street and
    // house numbers so the eye can tell them apart at a glance.
    core = `${designator} ${s}, ${h}`;
  } else {
    core = `${s} ${designator} ${h}`;
  }

  return m ? `${core} ${m}` : core;
}
