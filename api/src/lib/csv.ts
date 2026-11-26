function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((c) => csvEscape(c)).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
