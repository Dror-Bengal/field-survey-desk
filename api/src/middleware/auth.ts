import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { App, Principal } from '../types.js';

import { localAuth } from '../demo.js';

async function verifyFirebaseToken(authHeader: string | undefined): Promise<Principal> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'missing_bearer_token' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await localAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email, role: 'unknown' };
  } catch {
    throw new HTTPException(401, { message: 'invalid_token' });
  }
}

// Verifies the Firebase ID token and attaches { uid, email } to ctx.principal.
// Does NOT check whether the user is registered as a surveyor or admin.
// Use this for /surveyors/register and /me — routes that must work for any
// signed-in Firebase user regardless of app role.
export const requireFirebaseUser: MiddlewareHandler<App> = async (c, next) => {
  const principal = await verifyFirebaseToken(c.req.header('Authorization'));
  c.set('principal', principal);
  await next();
};

// Looks up the surveyor doc for the principal's firebase_uid.
// - 404 not_registered if no doc exists
// - 403 surveyor_not_active (with status + rejection_reason in body) if status !== 'active'
//   unless { allowAnyStatus: true }
export function requireSurveyor(opts: { allowAnyStatus?: boolean } = {}): MiddlewareHandler<App> {
  return async (c, next) => {
    let principal = c.get('principal') as Principal | undefined;
    if (!principal) {
      principal = await verifyFirebaseToken(c.req.header('Authorization'));
      c.set('principal', principal);
    }
    const { c: db } = await import('../db/collections.js');
    const surveyor = await db.surveyors().findOne({ firebase_uid: principal.uid });
    if (!surveyor) {
      return c.json({ error: { code: 'not_registered', message_en: 'not_registered' } }, 404);
    }
    if (!opts.allowAnyStatus && surveyor.status !== 'active') {
      return c.json(
        {
          error: {
            code: 'surveyor_not_active',
            message_en: 'surveyor_not_active',
            status: surveyor.status,
            ...(surveyor.rejection_reason && { rejection_reason: surveyor.rejection_reason }),
          },
        },
        403,
      );
    }
    principal.role = 'surveyor';
    principal.surveyor_id = surveyor._id;
    await next();
  };
}

// Looks up the admin doc; 403 if none.
export const requireAdmin: MiddlewareHandler<App> = async (c, next) => {
  let principal = c.get('principal') as Principal | undefined;
  if (!principal) {
    principal = await verifyFirebaseToken(c.req.header('Authorization'));
    c.set('principal', principal);
  }
  const { c: db } = await import('../db/collections.js');
  const admin = await db.admins().findOne({ firebase_uid: principal.uid });
  if (!admin) {
    throw new HTTPException(403, { message: 'admin_required' });
  }
  principal.role = 'admin';
  principal.admin_id = admin._id;
  await next();
};
