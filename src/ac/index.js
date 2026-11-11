/**
 * Live ActiveCampaign data source. Same interface as src/demo.js:
 *   connect(), listLeads({ refresh }), getLead(email)
 *
 * Endpoints used (ActiveCampaign REST v3 unless noted):
 *   GET /users/me                                  connection check
 *   GET /contacts?email=...                        find contact by email
 *   GET /contacts?limit=&tagid=&listid=            "Retrieve all leads"
 *   GET /contacts/{id}                             contact + sideloaded deals, fieldValues, contactTags
 *   GET /dealStages/{id}, GET /tags/{id}           stage and tag names (cached)
 *   GET /contacts/{id}/trackingLogs                site-tracking page visits
 *   GET /activities?contact={id}&include=...       campaign sends and link clicks
 *   GET /campaigns/{id}                            campaign name (cached, only when not sideloaded)
 *   v1  campaign_report_open_list?campaignid=      opens per campaign (cached)   [AC_OPENS_SOURCE=v1]
 */
import { config } from '../config.js';
import { ACClient, ACError } from './client.js';
import { createLog } from '../log.js';
import { mapContact, dealStageLabel, mapVisits, mapEmailActivity, parseOpenList, opensFor } from './map.js';

const cfg = config.ac;
let client = null;
const ac = () => (client ||= new ACClient({ url: cfg.url, key: cfg.key, rps: cfg.rps }));

/* ---------- small TTL cache ---------- */
const cache = new Map();
async function cached(key, ttlSec, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  if (ttlSec > 0) cache.set(key, { val, exp: Date.now() + ttlSec * 1000 });
  return val;
}
const LONG = 3600;

async function stageTitle(id) {
  if (!id) return null;
  return cached('stage:' + id, LONG, async () => {
    try { const r = await ac().v3('/dealStages/' + id); return (r.dealStage && r.dealStage.title) || null; } catch { return null; }
  });
}
async function tagName(id) {
  return cached('tag:' + id, LONG, async () => {
    try { const r = await ac().v3('/tags/' + id); return (r.tag && r.tag.tag) || null; } catch { return null; }
  });
}
async function campaignName(id) {
  return cached('campaign:' + id, LONG, async () => {
    try { const r = await ac().v3('/campaigns/' + id); return (r.campaign && r.campaign.name) || null; } catch { return null; }
  });
}
async function openRows(campaignId) {
  return cached('opens:' + campaignId, 600, async () => {
    try { return parseOpenList(await ac().v1('campaign_report_open_list', { campaignid: campaignId })); }
    catch (e) { return { ok: false, rows: [], error: e.publicMessage || e.message }; }
  });
}

/* ---------- interface ---------- */
export async function connect() {
  const log = createLog();
  try {
    const r = await ac().v3('/users/me');
    const u = r.user || {};
    log.ok('Authorized with ActiveCampaign', u.email || u.username || 'API user');
    return { connected: true, mode: 'live', account: cfg.url.replace(/^https?:\/\//, ''), user: u.email || u.username || '', siteDomain: cfg.siteDomain, log: log.entries };
  } catch (e) {
    log.fail('Authorizing with ActiveCampaign', e);
    const err = new Error(e.publicMessage || 'Could not connect to ActiveCampaign');
    err.status = e.status === 401 || e.status === 403 ? 401 : 502;
    err.log = log.entries;
    throw err;
  }
}

export async function getLead(email) {
  const log = createLog();
  log.info('Lead: ' + email);
  let found;
  try {
    const r = await ac().v3('/contacts', { email });
    found = (r.contacts || []).find(c => String(c.email || '').toLowerCase() === email) || (r.contacts || [])[0];
  } catch (e) {
    log.fail('Looking up contact by email', e);
    const err = new Error(e.publicMessage || 'Lookup failed'); err.status = 502; err.log = log.entries; throw err;
  }
  if (!found) { log.fail('Looking up contact by email', 'no contact'); return { notFound: true, log: log.entries }; }
  log.ok('Looked up contact by email', '#' + found.id);
  const out = await buildLead(found.id, log);
  return { ...out, log: log.entries };
}

export async function listLeads({ refresh = false } = {}) {
  const key = `leads:${cfg.leadTagId}:${cfg.leadListId}:${cfg.maxLeads}`;
  if (refresh) cache.delete(key);
  return cached(key, cfg.cacheSeconds, async () => {
    const log = createLog();
    let contacts = [];
    try {
      const r = await ac().v3('/contacts', { limit: cfg.maxLeads, tagid: cfg.leadTagId, listid: cfg.leadListId });
      contacts = r.contacts || [];
      log.ok('Retrieved contacts', contacts.length + ' leads' + (r.meta && r.meta.total ? ` (of ${r.meta.total})` : ''));
    } catch (e) {
      log.fail('Retrieving contacts', e);
      const err = new Error(e.publicMessage || 'Could not list contacts'); err.status = 502; err.log = log.entries; throw err;
    }
    const leads = [];
    for (const c of contacts) {
      try {
        const sub = createLog();
        const { lead } = await buildLead(c.id, sub);
        leads.push(lead);
      } catch (e) {
        log.fail('Reading activity for contact #' + c.id, e);
      }
    }
    log.ok('Read site and email activity for all leads', 'built ' + leads.length + ' · ' + ac().calls + ' API calls this session');
    return { leads, log: log.entries, fetchedAt: new Date().toISOString() };
  });
}

/* ---------- assembly ---------- */
async function buildLead(contactId, log) {
  const now = Date.now();

  // 1. Contact, deals, tags
  let contact;
  try {
    const r = await ac().v3('/contacts/' + contactId);
    contact = mapContact(r, { titleFieldId: cfg.titleFieldId, companyFieldId: cfg.companyFieldId });
  } catch (e) {
    log.fail('Reading contact fields', e);
    throw e;
  }
  const stageTitles = {};
  for (const d of contact.deals) if (d.stage) stageTitles[String(d.stage)] = await stageTitle(d.stage);
  const stage = dealStageLabel(contact.deals, stageTitles);
  const tags = (await Promise.all(contact.contactTagIds.slice(0, 15).map(tagName))).filter(Boolean);
  log.ok('Read contact fields and deal stage', stage);

  // 2. Site tracking
  let visits = [], vstats = null;
  try {
    const r = await ac().v3(`/contacts/${contactId}/trackingLogs`);
    ({ visits, stats: vstats } = mapVisits(r, { siteDomain: cfg.siteDomain, windowDays: cfg.windowDays, now }));
    log.ok('Read site-tracking visits', `${vstats.pageVisits} page views` + (vstats.noTimestamp ? ` · ${vstats.noTimestamp} without a date` : '') + (vstats.otherDomain ? ` · ${vstats.otherDomain} on other domains skipped` : ''));
  } catch (e) { log.fail('Reading site-tracking visits', e); }

  // 3. Campaign sends and clicks
  let emails = [], estats = null;
  try {
    const after = new Date(now - cfg.windowDays * 864e5).toISOString().slice(0, 10);
    const r = await ac().v3('/activities', { contact: contactId, include: 'reference.log.campaign,reference.link', 'orders[tstamp]': 'desc', limit: 100, after });
    ({ emails, stats: estats } = mapEmailActivity(r, { windowDays: cfg.windowDays, now }));
    for (const e of emails) if (e.campaignId && /^Campaign #/.test(e.campaign)) e.campaign = (await campaignName(e.campaignId)) || e.campaign;
  } catch (e) { log.fail('Reading email campaign activity', e); }

  // 4. Opens (not in the activity feed)
  let opensNote = 'opens off';
  if (cfg.opensSource === 'v1' && emails.length) {
    let okCount = 0;
    for (const e of emails) {
      if (!e.campaignId) continue;
      const o = await openRows(e.campaignId);
      if (o.ok) { e.opens = opensFor(o.rows, { contactId: contact.contactId, email: contact.email }); okCount++; }
    }
    opensNote = okCount ? `opens read for ${okCount} campaign${okCount === 1 ? '' : 's'}` : 'opens unavailable';
  }
  if (estats) {
    const opens = emails.reduce((t, e) => t + (e.opens || 0), 0), clicks = emails.reduce((t, e) => t + e.clicks.length, 0);
    log.ok('Read email campaign activity', `${emails.length} campaigns · ${opens} opens · ${clicks} clicks · ${opensNote}` + (estats.unresolved.sends || estats.unresolved.clicks ? ` · ${estats.unresolved.sends + estats.unresolved.clicks} not linked to a campaign` : ''));
  }

  const domain = contact.email.split('@')[1] || '';
  const lead = {
    id: 'ac-' + contact.contactId,
    contactId: contact.contactId,
    name: contact.name,
    email: contact.email,
    title: contact.title,
    company: contact.company,
    companyIsDomain: !contact.company,
    domain,
    location: '',
    tags,
    stage,
    source: 'ActiveCampaign',
    visits,
    emails,
    dataNotes: {
      opens: cfg.opensSource === 'v1' ? opensNote : 'disabled',
      visitTime: 'ActiveCampaign site tracking does not record time on page',
      windowDays: cfg.windowDays
    }
  };
  const payload = {
    contact: { id: contact.contactId, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, title: contact.title, organization: contact.company, tags, dealStage: stage },
    siteTracking: { domain: cfg.siteDomain, window: cfg.windowDays + 'd', visits: visits.map(v => ({ url: v.url, pageTitle: v.title, views: v.count, lastVisit: v.lastVisit })), stats: vstats },
    emailActivity: emails.map(e => ({ campaignId: e.campaignId, campaign: e.campaign, sentDate: e.sentDate, opens: e.opens, clicks: e.clicks.map(c => c.url || c.label) })),
    stats: estats
  };
  return { lead, payload };
}

export { ACError };
