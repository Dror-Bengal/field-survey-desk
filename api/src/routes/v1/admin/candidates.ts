import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { c } from '../../../db/collections.js';
import type { CandidateDoc } from '../../../db/types.js';
import { parseObjectId } from '../../../lib/objectid.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import { CandidateBody, UpdateCandidateBody } from '../../../schemas/admin.js';
import type { App } from '../../../types.js';

export const adminCandidatesRoutes = new Hono<App>();

adminCandidatesRoutes.use('*', requireFirebaseUser, requireAdmin);

adminCandidatesRoutes.get('/', async (ctx) => {
  const items = await c.candidates().find().sort({ display_order: 1 }).toArray();
  return ctx.json({
    items: items.map((c) => ({
      id: c._id!.toHexString(),
      name_local: c.name_local,
      name_en: c.name_en,
      short_local: c.short_local,
      short_en: c.short_en,
      type: c.type,
      display_order: c.display_order,
      active: c.active,
      ...(c.response_type !== undefined && { response_type: c.response_type }),
    })),
  });
});

adminCandidatesRoutes.post('/', async (ctx) => {
  const body = CandidateBody.parse(await ctx.req.json());
  const res = await c.candidates().insertOne(body as CandidateDoc);
  return ctx.json({ id: res.insertedId.toHexString() }, 201);
});

adminCandidatesRoutes.patch('/:id', async (ctx) => {
  const id = parseObjectId(ctx.req.param('id'), 'candidate_id');
  const body = UpdateCandidateBody.parse(await ctx.req.json());
  const result = await c
    .candidates()
    .findOneAndUpdate({ _id: id }, { $set: body }, { returnDocument: 'after' });
  if (!result) throw new HTTPException(404, { message: 'candidate_not_found' });
  return ctx.json({ id: result._id!.toHexString(), ...result });
});

adminCandidatesRoutes.delete('/:id', async (ctx) => {
  // Same destructive-action gate pattern as DELETE /admin/responses/all:
  // the URL must carry ?confirm=DELETE_CANDIDATE to defend against
  // accidental curls / browser-history rebroadcasts.
  if (ctx.req.query('confirm') !== 'DELETE_CANDIDATE') {
    throw new HTTPException(400, { message: 'confirm_required' });
  }
  const id = parseObjectId(ctx.req.param('id'), 'candidate_id');
  const usage = await c.responses().countDocuments({ candidate_id: id });
  if (usage > 0) {
    const res = await c.candidates().updateOne({ _id: id }, { $set: { active: false } });
    if (res.matchedCount === 0) throw new HTTPException(404, { message: 'candidate_not_found' });
    return ctx.json({ id: id.toHexString(), soft_deleted: true, in_use: usage });
  }
  const res = await c.candidates().deleteOne({ _id: id });
  if (res.deletedCount === 0) throw new HTTPException(404, { message: 'candidate_not_found' });
  return ctx.json({ id: id.toHexString(), deleted: true });
});
