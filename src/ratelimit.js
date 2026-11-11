/**
 * Small in-memory fixed-window rate limiter (one Render instance, so memory is enough).
 * Used for the public demo's Claude drafts (keeps OpenRouter/Anthropic spend bounded) and for sign-in attempts.
 */
export function rateLimit({ windowMs, max, key = req => req.ip || 'unknown', onLimit }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let h = hits.get(k);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    h.n++;
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset <= now) hits.delete(kk);
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return onLimit ? onLimit(req, res) : res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    }
    next();
  };
}
