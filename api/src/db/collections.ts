import type { Collection, Document } from 'mongodb';
import { getDb } from './client.js';
import type {
  AdminDoc,
  CandidateDoc,
  PollingStationDoc,
  ResponseDoc,
  SettlementDoc,
  SurveySessionDoc,
  SurveyorDoc,
  VoterDoc,
} from './types.js';

export const COLLECTIONS = {
  voters: 'voters',
  pollingStations: 'polling_stations',
  settlements: 'settlements',
  candidates: 'candidates',
  surveyors: 'surveyors',
  admins: 'admins',
  surveySessions: 'survey_sessions',
  responses: 'responses',
} as const;

export const c = {
  voters: () => getDb().collection<VoterDoc>(COLLECTIONS.voters),
  pollingStations: () => getDb().collection<PollingStationDoc>(COLLECTIONS.pollingStations),
  settlements: () => getDb().collection<SettlementDoc>(COLLECTIONS.settlements),
  candidates: () => getDb().collection<CandidateDoc>(COLLECTIONS.candidates),
  surveyors: () => getDb().collection<SurveyorDoc>(COLLECTIONS.surveyors),
  admins: () => getDb().collection<AdminDoc>(COLLECTIONS.admins),
  surveySessions: () => getDb().collection<SurveySessionDoc>(COLLECTIONS.surveySessions),
  responses: () => getDb().collection<ResponseDoc>(COLLECTIONS.responses),
  raw: <T extends Document>(name: string): Collection<T> => getDb().collection<T>(name),
};
