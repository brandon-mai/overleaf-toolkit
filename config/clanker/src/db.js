import { createClient } from 'redis';
import { MongoClient } from 'mongodb';
import { REDIS_HOST, MONGO_URL, CLANKER_SESSION_ID, CLANKER_USER_ID, CLANKER_EMAIL } from './config.js';

export const redisClient = createClient({
  url: `redis://${REDIS_HOST}:6379`
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

export const mongoClient = new MongoClient(MONGO_URL);
export let db;

export async function initDb() {
  await mongoClient.connect();
  db = mongoClient.db();
  console.log('Connected to MongoDB');

  await redisClient.connect();
  console.log('Connected to Redis');

  // Clean up any stale connected_user keys for Clanker from previous runs
  try {
    const keys = await redisClient.keys('connected_user:*');
    for (const key of keys) {
      const info = await redisClient.hGetAll(key);
      if (info && info.user_id === CLANKER_USER_ID) {
        console.log(`Cleaning up stale Clanker connected_user key: ${key}`);
        await redisClient.del(key);
      }
    }
  } catch (err) {
    console.error('Failed to clean up stale Clanker presence keys:', err.message);
  }

  // Insert mock session for Clanker if not exists
  const sessionKey = `sess:${CLANKER_SESSION_ID}`;
  const sessionData = {
    cookie: {
      originalMaxAge: 432000000,
      expires: "2036-07-25T07:08:02.325Z",
      secure: false,
      httpOnly: true,
      path: "/",
      sameSite: "lax"
    },
    passport: {
      user: {
        _id: CLANKER_USER_ID,
        first_name: "Clanker",
        last_name: "",
        email: CLANKER_EMAIL
      }
    },
    validationToken: "v1:1234"
  };
  await redisClient.set(sessionKey, JSON.stringify(sessionData));
  console.log('Clanker session initialized in Redis');
}
