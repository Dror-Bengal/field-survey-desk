import { Hono } from 'hono';
import type { App } from '../../../types.js';
import { adminCandidatesRoutes } from './candidates.js';
import { adminCommunitiesRoutes } from './communities.js';
import { dashboardRoutes } from './dashboard.js';
import { adminPollingStationsRoutes } from './polling-stations.js';
import { adminResponsesRoutes } from './responses.js';
import { adminSessionsRoutes } from './sessions.js';
import { adminSettlementsRoutes } from './settlements.js';
import { adminSurveyorsRoutes } from './surveyors.js';

export const adminRoutes = new Hono<App>();

adminRoutes.route('/dashboard', dashboardRoutes);
adminRoutes.route('/responses', adminResponsesRoutes);
adminRoutes.route('/sessions', adminSessionsRoutes);
adminRoutes.route('/settlements', adminSettlementsRoutes);
adminRoutes.route('/surveyors', adminSurveyorsRoutes);
adminRoutes.route('/candidates', adminCandidatesRoutes);
adminRoutes.route('/communities', adminCommunitiesRoutes);
adminRoutes.route('/polling-stations', adminPollingStationsRoutes);
