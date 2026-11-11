import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { basicAuth } from './src/auth.js';
import * as live from './src/ac/index.js';
import * as demo from './src/demo.js';
import { draftEmail, llmStatus } from './src/llm.js';
import { readContentFiles } from './src/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = config.demo ? demo : live;
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// Render health check (no auth, no data).
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(basicAuth(config.auth, { isProd: config.isProd }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/api/status', (req, res) => {
  res.json({
    mode: config.demo ? 'demo' : 'live',
    siteDomain: config.ac.siteDomain,
    windowDays: config.ac.windowDays,
    maxLeads: config.ac.maxLeads,
    opensSource: config.demo ? 'demo' : config.ac.opensSource,
    llm: llmStatus(),
    sender: config.sender
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

app.get('/api/content', wrap(async (req, res) => {
  res.json({ files: await readContentFiles(path.resolve(__dirname, config.contentDir)) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

// Errors: never leak stack traces or keys.
app.use((err, req, res, next) => {
  const status = Number(err.status) || 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err.message);
  res.status(status).json({ error: err.publicMessage || err.message || 'Something went wrong', log: err.log || [] });
});

app.listen(config.port, () => {
  console.log(`Lead Nurture Copilot on :${config.port} · ${config.demo ? 'DEMO data (ActiveCampaign not configured)' : 'LIVE ActiveCampaign ' + config.ac.url} · LLM ${llmStatus().available ? llmStatus().provider : 'not configured (template drafts)'}`);
});
