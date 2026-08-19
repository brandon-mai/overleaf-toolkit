import signature from 'cookie-signature';

export const REDIS_HOST = process.env.REDIS_HOST || 'redis';
export const SHARELATEX_URL = process.env.SHARELATEX_URL || 'http://sharelatex';
export const CLANKER_USER_ID = process.env.CLANKER_USER_ID || '';
export const CLANKER_EMAIL = process.env.CLANKER_EMAIL || '';
export const SESSION_SECRET = process.env.OVERLEAF_SESSION_SECRET || '';
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
export const CLANKER_MODEL = process.env.CLANKER_MODEL || 'google/gemma-4-31b-it';
export const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017/sharelatex';

export const CLANKER_SESSION_ID = 'clanker_session_key_1234';
export const signedSessionCookie = 's:' + encodeURIComponent(signature.sign(CLANKER_SESSION_ID, SESSION_SECRET));
export const cookieHeader = `overleaf.sid=${signedSessionCookie}`;
