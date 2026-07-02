// Single-user auth: one access code (env TRYDON_ACCESS_CODE) → signed session
// cookie. If no code is configured the deck runs open (local/dev use).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getMeta, setMeta } from './db.js';

const SESSION_DAYS = 90;

let secret = getMeta('session_secret');
if (!secret) {
  secret = randomBytes(32).toString('hex');
  setMeta('session_secret', secret);
}

export const accessCode = () => process.env.TRYDON_ACCESS_CODE || '';

function sign(payload) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function makeSession() {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `trydon.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function checkSession(cookieHeader = '') {
  if (!accessCode()) return true; // auth disabled
  const m = /(?:^|;\s*)trydon_sess=([^;]+)/.exec(cookieHeader);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 3) return false;
  const [tag, exp, sig] = parts;
  if (tag !== 'trydon' || Number(exp) < Date.now()) return false;
  const expect = sign(`${tag}.${exp}`);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

export function checkCode(code) {
  const want = accessCode();
  if (!want) return true;
  const a = Buffer.from(String(code || ''));
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookie() {
  const secure = process.env.TRYDON_INSECURE_COOKIE ? '' : ' Secure;';
  return `trydon_sess=${makeSession()}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${secure} SameSite=Lax`;
}
