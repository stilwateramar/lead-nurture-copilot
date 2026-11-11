import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * HTTP Basic auth for the whole app (the page shows CRM data).
 * Enabled when APP_PASSWORD is set. In production without a password, every request is refused.
 */
export function basicAuth({ user, password }, { isProd }) {
  if (!password) {
    if (isProd) {
      console.warn('[auth] APP_PASSWORD is not set. Refusing all requests in production.');
      return (req, res) => res.status(503).type('text').send('Set APP_PASSWORD in the Render environment to use this app.');
    }
    console.warn('[auth] APP_PASSWORD is not set. Running without a password (development only).');
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      if (safeEqual(u, user) && safeEqual(rest.join(':'), password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Lead Nurture Copilot", charset="UTF-8"');
    res.status(401).type('text').send('Authentication required.');
  };
}
