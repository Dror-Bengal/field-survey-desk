import { T } from '../../i18n.js';
import { STATUS_LABEL } from './helpers.js';

const CLASS_BY_STATUS = {
  asked: 'status-asked',
  pending: 'status-pending',
  refused: 'status-refused',
  not_home: 'status-not-home',
};

export function StatusPill({ status, lang }) {
  return (
    <span className={`status-pill ${CLASS_BY_STATUS[status] || ''}`}>
      {T(lang, STATUS_LABEL[status])}
    </span>
  );
}
