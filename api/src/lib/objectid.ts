import { HTTPException } from 'hono/http-exception';
import { ObjectId } from 'mongodb';

export function parseObjectId(raw: string, field = 'id'): ObjectId {
  if (!ObjectId.isValid(raw)) {
    throw new HTTPException(400, { message: `invalid_${field}` });
  }
  return new ObjectId(raw);
}
