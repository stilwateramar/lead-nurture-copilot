import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { requireLogin, hasSession, checkCredentials, startSession, endSession } from './src/auth.js';
import { rateLimit } from './src/ratelimit.js';
import * as live from './src/ac/index.js';
import * as demo from './src/demo.js';
import { draftEmail, llmStatus } from './src/llm.js';
import { readContentFiles } from './src/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');
const source = config.demo ? demo : live;
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (req.path.startsWith('/api/') || req.path.startsWith('/demo/api/')) res.set('Cache-Control', 'no-store');
  next();
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const page = file => (req, res) => res.sendFile(path.join(PUB, file));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contentDir = path.resolve(__dirname, config.contentDir);

// Render health check (no auth, no data).
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------- Public demo (/demo): no sign-in, no ActiveCampaign ----------
   The five fictional leads, scoring, matching, approvals and the log all run in the browser (public/demo-data.js).
   Only two things touch the server: your content/ files, and Claude drafts (the API key must stay server-side).
   Drafts are limited to the demo leads and rate-limited so the public page can't run up the LLM bill. */
app.get('/demo', page('index.html'));
for (const f of ['core.js', 'app.js', 'demo-data.js']) app.get('/' + f, page(f));

app.get('/demo/api/status', (req, res) => {
  res.json({ siteDomain: config.ac.siteDomain, llm: { available: llmStatus().available }, sender: config.sender });
});
app.get('/demo/api/content', wrap(async (req, res) => res.json({ files: await readContentFiles(contentDir) })));

const draftLimited = (req, res) => res.json({ ok: false, code: 'rate_limited', message: 'Too many demo drafts right now.' });
const demoDraftPerIp = rateLimit({ windowMs: 10 * 60e3, max: 20, onLimit: draftLimited });
const demoDraftDaily = rateLimit({ windowMs: 24 * 3600e3, max: 300, key: () => 'all', onLimit: draftLimited });
app.post('/demo/api/draft', (req, res, next) => {
  const facts = req.body && req.body.facts;
  if (!facts || typeof facts !== 'object' || !facts.lead || !facts.sender || JSON.stringify(facts).length > 24000) return res.status(400).json({ ok: false, code: 'bad_request', message: 'Missing facts.' });
  if (!demo.isDemoLead(facts.lead)) return res.json({ ok: false, code: 'not_demo', message: 'The public demo drafts for the demo leads only.' });
  next();
}, demoDraftPerIp, demoDraftDaily, wrap(async (req, res) => res.json(await draftEmail(req.body.facts))));

/* ---------- Sign-in (replaces the browser's Basic-auth popup) ---------- */
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10, onLimit: (req, res) => res.redirect(303, '/login?error=locked') });
app.get('/login', (req, res) => {
  if (!config.auth.password || hasSession(req, config.auth)) return res.redirect(302, '/');
  page('login.html')(req, res);
});
app.post('/login', loginLimiter, express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
  const { user = '', password = '' } = req.body || {};
  if (checkCredentials(config.auth, String(user), String(password))) { startSession(res, config.auth, config.isProd); return res.redirect(303, '/'); }
  res.redirect(303, '/login?error=1');
});
app.post('/logout', (req, res) => { endSession(res, config.isProd); res.redirect(303, config.demo ? '/demo' : '/login'); });

// No ActiveCampaign configured: there is no real data to protect, so the site opens straight into the demo.
if (config.demo) app.get('/', (req, res) => res.redirect(302, '/demo'));

/* ---------- Protected app ---------- */
app.use(requireLogin(config.auth, { isProd: config.isProd }));

app.get('/api/status', (req, res) => {
  res.json({
    mode: config.demo ? 'demo' : 'live',
    siteDomain: config.ac.siteDomain,
    windowDays: config.ac.windowDays,
    maxLeads: config.ac.maxLeads,
    opensSource: config.demo ? 'demo' : config.ac.opensSource,
    llm: llmStatus(),
    sender: config.sender,
    auth: !!config.auth.password
  });
});

app.post('/api/connect', wrap(async (req, res) => res.json(await source.connect())));

app.get('/api/leads', wrap(async (req, res) => res.json(await source.listLeads({ refresh: req.query.refresh === '1' }))));

app.get('/api/lead', wrap(async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const r = await source.getLead(email);
  if (r.notFound) return res.status(404).json({ error: `No contact found in ActiveCampaign for ${email}.`, log: r.log });
  res.json(r);
}));

app.post('/api/draft', wrap(async (req, res) => {
  const facts = req.body && req.body.facts;
  if (!facts || typeof facts !== 'object' || !facts.lead || !facts.sender) return res.status(400).json({ ok: false, code: 'bad_request', message: 'Missing facts.' });
  const r = await draftEmail(facts);
  res.json(r); // on ok:false the browser falls back to the template draft
}));

app.get('/api/content', wrap(async (req, res) => res.json({ files: await readContentFiles(contentDir) })));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(PUB, { extensions: ['html'], index: 'index.html' }));

// Errors: never leak stack traces or keys.
app.use((err, req, res, next) => {
  const status = Number(err.status) || 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err.message);
  res.status(status).json({ error: err.publicMessage || err.message || 'Something went wrong', log: err.log || [] });
});

app.listen(config.port, () => {
  console.log(`Lead Nurture Copilot on :${config.port} · ${config.demo ? 'DEMO data (ActiveCampaign not configured) · / opens /demo' : 'LIVE ActiveCampaign ' + config.ac.url} · LLM ${llmStatus().available ? llmStatus().provider : 'not configured (template drafts)'}`);
});
