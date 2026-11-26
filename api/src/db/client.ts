import { type Db, MongoClient } from 'mongodb';
import { env } from '../env.js';
import { logger } from '../logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });

  await client.connect();
  db = client.db(env.MONGODB_DB);
  await db.command({ ping: 1 });

  logger.info({ db: env.MONGODB_DB }, 'connected to MongoDB');
  return db;
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('disconnected from MongoDB');
  }
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected; call connectMongo() first');
  return db;
}
