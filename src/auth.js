/**
 * Sign-in for the live app (the page shows CRM data). Enabled when APP_PASSWORD is set.
 * A styled /login page sets a signed, HttpOnly session cookie, so there is no browser Basic-auth popup.
 * The signing key is derived from APP_USER + APP_PASSWORD: changing the password signs everyone out.
 * In production without APP_PASSWORD, every protected request is refused.
 */
import crypto from 'node:crypto';

const COOKIE = 'lnc_session';
const TTL_MS = 7 * 864e5;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const secretOf = ({ user, password }) => crypto.createHash('sha256').update('lnc-session\0' + user + '\0' + password).digest();
const sign = (exp, auth) => crypto.createHmac('sha256', secretOf(auth)).update(String(exp)).digest('base64url');

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; } }
  }
  return '';
}
function setCookie(res, value, maxAgeSec, isProd) {
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (isProd ? '; Secure' : ''));
}

export function hasSession(req, auth) {
  if (!auth.password) return false;
  const [exp, sig] = readCookie(req, COOKIE).split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, sign(exp, auth));
}
export const checkCredentials = (auth, user, password) => !!auth.password && safeEqual(user, auth.user) && safeEqual(password, auth.password);
export function startSession(res, auth, isProd) { const exp = Date.now() + TTL_MS; setCookie(res, exp + '.' + sign(exp, auth), TTL_MS / 1000, isProd); }
export function endSession(res, isProd) { setCookie(res, '', 0, isProd); }

/** Gate for protected routes: pages redirect to /login, API calls get 401 JSON. */
export function requireLogin(auth, { isProd }) {
  if (!auth.password) {
    if (isProd) {
      console.warn('[auth] APP_PASSWORD is not set. Refusing protected requests in production.');
      return (req, res) => res.status(503).type('text').send('Set APP_PASSWORD in the Render environment to use this app.');
    }
    console.warn('[auth] APP_PASSWORD is not set. Running without sign-in (development only).');
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    if (hasSession(req, auth)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Your session has ended. Reload the page to sign in again.' });
    res.redirect(302, '/login');
  };
}
