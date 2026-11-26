export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}
