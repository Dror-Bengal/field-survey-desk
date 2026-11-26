// Display helpers shared across screens.

export function voterName(v) {
  return v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' ');
}

export const settlementName = (s) => s.name_en || s.name_local;
export const streetName = (st) => st.street || st.name_en;
export const partyName = (p) => p.name_en || p.name_local;

export const STATUS_LABEL = {
  asked: 'asked', pending: 'pending', refused: 'refused', not_home: 'not_home',
};

export const AGE_LABEL = {
  young: 'age_young', adult: 'age_adult', senior: 'age_senior', child: 'age_young',
};
