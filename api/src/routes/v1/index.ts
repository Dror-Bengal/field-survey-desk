import { Hono } from 'hono';
import type { App } from '../../types.js';
import { addressesRoutes } from './addresses.js';
import { adminRoutes } from './admin/index.js';
import { candidatesRoutes } from './candidates.js';
import { communitiesRoutes } from './communities.js';
import { meRoutes } from './me.js';
import { pollingStationsRoutes } from './polling-stations.js';
import { responsesRoutes } from './responses.js';
import { sessionsRoutes } from './sessions.js';
import { settlementsRoutes } from './settlements.js';
import { surveyorsRoutes } from './surveyors.js';
import { votersRoutes } from './voters.js';

export const v1Routes = new Hono<App>();

v1Routes.route('/surveyors', surveyorsRoutes);
v1Routes.route('/sessions', sessionsRoutes);
v1Routes.route('/settlements', settlementsRoutes);
v1Routes.route('/communities', communitiesRoutes);
v1Routes.route('/polling-stations', pollingStationsRoutes);
v1Routes.route('/addresses', addressesRoutes);
v1Routes.route('/voters', votersRoutes);
v1Routes.route('/candidates', candidatesRoutes);
v1Routes.route('/responses', responsesRoutes);
v1Routes.route('/me', meRoutes);
v1Routes.route('/admin', adminRoutes);
