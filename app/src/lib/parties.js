export const PRIORITY_PARTY_CODES = ['A', 'B'];

const PRIORITY_INDEX = new Map(PRIORITY_PARTY_CODES.map((code, i) => [code, i]));

// Split a parties list into [priority, others] where priority is sorted by
// the curated order above and others keeps the backend's display_order.
// Caller passes only `type === 'party'` candidates — non-answer rows are
// outside this picker.
export function splitParties(parties) {
  const priorityBuckets = new Array(PRIORITY_PARTY_CODES.length).fill(null);
  const others = [];
  for (const p of parties || []) {
    const idx = PRIORITY_INDEX.get(p?.short_en);
    if (idx !== undefined && priorityBuckets[idx] === null) {
      priorityBuckets[idx] = p;
    } else {
      others.push(p);
    }
  }
  return {
    priority: priorityBuckets.filter(Boolean),
    others,
  };
}
