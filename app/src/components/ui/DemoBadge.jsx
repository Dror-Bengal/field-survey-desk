// Backend voters carry `inferred_gender` ('M'|'F'|'U') and `age_bucket`
// ('child'|'young'|'adult'|'senior'). Render symbol + age bracket.

const BRACKETS = {
  child:  '<18',
  young:  '18–35',
  adult:  '36–60',
  senior: '60+',
};

export function DemoBadge({ gender, age_bucket }) {
  const symbol =
    gender === 'M' ? '♂' :
    gender === 'F' ? '♀' :
    '?';
  const color =
    gender === 'M' ? 'oklch(0.55 0.10 250)' :
    gender === 'F' ? 'oklch(0.55 0.10 20)' :
    'var(--text-3)';
  const bracket = BRACKETS[age_bucket] || '?';
  return (
    <span className="demo-badge">
      <span style={{ color }}>{symbol}</span> {bracket}
    </span>
  );
}
