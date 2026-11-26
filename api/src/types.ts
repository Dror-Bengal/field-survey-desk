import type { ObjectId } from 'mongodb';

export interface Principal {
  uid: string;
  email?: string;
  role: 'surveyor' | 'admin' | 'unknown';
  surveyor_id?: ObjectId;
  admin_id?: ObjectId;
}

export type App = {
  Variables: {
    principal: Principal;
    requestId: string;
  };
};
