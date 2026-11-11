/**
 * Raw ActiveCampaign responses -> the lead shape the UI scores:
 *
 * lead = {
 *   id, contactId, name, email, title, company, location, tags[], stage, source,
 *   visits: [{ path, url, title, topics[], daysAgo|null, lastVisit|null, count, secs|null }],
 *   emails: [{ campaignId, campaign, subject, sentDate|null, sent(daysAgo)|null, opens(number|null), clicks: [{ label, url, topics[] }], topics[] }]
 * }
 *
 * Field names marked UNVERIFIED are not confirmed by ActiveCampaign's public docs.
 * Run `npm run probe -- --email someone@example.com` and compare probe-output/*.json
 * against these mappers before trusting live numbers. Every mapper reads defensively so a
 * wrong guess yields "missing data", never invented data.
 */
import { topicsFor, titleFor } from '../topics.js';

const DAY = 864e5;

export function daysAgoFrom(ts, now = Date.now()) {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}
const isoDay = ts => { const t = Date.parse(ts); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };

/** Index every array-valued top-level key (sideloads) by id: { logs: Map, campaigns: Map, ... }. */
export function indexSideloads(resp, skip = []) {
  const idx = {};
  for (const [k, v] of Object.entries(resp || {})) {
    if (skip.includes(k) || !Array.isArray(v)) continue;
    const m = new Map();
    v.forEach(x => { if (x && x.id != null) m.set(String(x.id), x); });
    idx[k] = m;
  }
  return idx;
}
const pick = (idx, keys, id) => {
  if (id == null) return null;
  for (const k of keys) { const m = idx[k]; if (m && m.has(String(id))) return m.get(String(id)); }
  return null;
};

/* ---------- Contact: GET /api/3/contacts/{id} ---------- */
export function mapContact(resp, { titleFieldId, companyFieldId } = {}) {
  const c = (resp && resp.contact) || {};
  const fv = Array.isArray(resp && resp.fieldValues) ? resp.fieldValues : [];
  const field = id => { if (!id) return ''; const f = fv.find(x => String(x.field) === String(id)); return f ? String(f.value || '').trim() : ''; };
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || 'Unknown contact';
  return {
    contactId: c.id != null ? String(c.id) : null,
    email: String(c.email || '').toLowerCase(),
    name,
    firstName: c.firstName || name.split(' ')[0],
    lastName: c.lastName || '',
    phone: c.phone || '',
    title: field(titleFieldId),
    // `orgname` is present on some accounts (organizations are deprecated in favour of accounts). UNVERIFIED per account.
    company: field(companyFieldId) || String(c.orgname || '').trim(),
    created: c.cdate || null,
    updated: c.udate || null,
    dealIds: Array.isArray(resp && resp.deals) ? resp.deals.map(d => d.id) : [],
    deals: Array.isArray(resp && resp.deals) ? resp.deals : [],
    contactTagIds: Array.isArray(resp && resp.contactTags) ? resp.contactTags.map(t => String(t.tag)).filter(Boolean) : []
  };
}

const DEAL_STATUS = { 0: 'open', 1: 'won', 2: 'lost' };
/** deals[] from the contact sideload + resolved stage titles -> "Stage title · open". */
export function dealStageLabel(deals, stageTitles = {}) {
  if (!deals || !deals.length) return 'No deal';
  const open = deals.find(d => String(d.status) === '0') || deals[0];
  const st = stageTitles[String(open.stage)] || (open.stage ? 'Stage #' + open.stage : 'Deal');
  return st + ' · ' + (DEAL_STATUS[String(open.status)] || 'open') + (deals.length > 1 ? ` (+${deals.length - 1} more)` : '');
}

/* ---------- Site tracking: GET /api/3/contacts/{id}/trackingLogs ---------- */
// Confirmed by docs: entries under `trackingLogs`; `type` is "__pagevisit" for page visits; `value` holds the page URL.
// UNVERIFIED: the timestamp field name (tried in order below) and any hit/count field.
const TS_KEYS = ['tstamp', 'timestamp', 'cdate', 'created_timestamp', 'createdTimestamp', 'date', 'created_at'];
const firstKey = (o, keys) => { for (const k of keys) if (o && o[k]) return o[k]; return null; };

export function mapVisits(resp, { siteDomain = '', windowDays = 30, now = Date.now() } = {}) {
  const logs = Array.isArray(resp && resp.trackingLogs) ? resp.trackingLogs : [];
  const groups = new Map();
  let skippedOld = 0, noTimestamp = 0, otherDomain = 0;
  for (const l of logs) {
    if (!l || l.type !== '__pagevisit') continue;
    const raw = String(l.value || l.url || '').trim();
    if (!raw) continue;
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw.replace(/^\/+/, '')); } catch { continue; }
    if (siteDomain && !u.hostname.toLowerCase().endsWith(siteDomain.toLowerCase())) { otherDomain++; continue; }
    const ts = firstKey(l, TS_KEYS);
    const d = daysAgoFrom(ts, now);
    if (d == null) noTimestamp++;
    else if (d > windowDays) { skippedOld++; continue; }
    const path = (u.pathname.replace(/\/+$/, '') || '/');
    const hits = Number(l.hits);
    const g = groups.get(path) || { path, url: u.origin + path, title: titleFor(path), topics: topicsFor(path), daysAgo: null, lastVisit: null, count: 0, secs: null };
    g.count += Number.isFinite(hits) && hits > 0 ? hits : 1;
    if (d != null && (g.daysAgo == null || d < g.daysAgo)) { g.daysAgo = d; g.lastVisit = isoDay(ts); }
    groups.set(path, g);
  }
  return {
    visits: Array.from(groups.values()).sort((a, b) => (a.daysAgo ?? 999) - (b.daysAgo ?? 999) || b.count - a.count),
    stats: { entries: logs.length, pageVisits: Array.from(groups.values()).reduce((t, g) => t + g.count, 0), skippedOld, noTimestamp, otherDomain }
  };
}

/* ---------- Email activity: GET /api/3/activities?contact={id}&include=reference.log.campaign,reference.link ---------- */
// Confirmed by docs: `activities[]` with `tstamp`, `reference_type` ("Log" = campaign send, "LinkData" = click,
// "MppLinkData" = privacy-proxy fetch, not a real click), `reference_id`. Opens are NOT in this feed.
// UNVERIFIED: sideload key names (`logs`, `campaigns`, `links`, `linkData`) and the field names that point
// from a log/linkData record to its campaign and link. The lookups below try several spellings.
export function mapEmailActivity(resp, { windowDays = 30, now = Date.now() } = {}) {
  const acts = Array.isArray(resp && resp.activities) ? resp.activities : [];
  const idx = indexSideloads(resp, ['activities']);
  const byCampaign = new Map();
  const unresolved = { sends: 0, clicks: 0 };
  const get = (cid) => {
    const key = cid != null ? String(cid) : 'unknown';
    if (!byCampaign.has(key)) {
      const camp = pick(idx, ['campaigns', 'campaign'], cid);
      byCampaign.set(key, {
        campaignId: cid != null ? String(cid) : null,
        campaign: camp && camp.name ? String(camp.name) : (cid != null ? 'Campaign #' + cid : 'Unattributed clicks'),
        subject: '',
        sentDate: null, sent: null, opens: null, clicks: [], topics: []
      });
    }
    return byCampaign.get(key);
  };
  for (const a of acts) {
    const d = daysAgoFrom(a.tstamp, now);
    if (d != null && d > windowDays) continue;
    const type = String(a.reference_type || '');
    if (type === 'Log') {
      const log = pick(idx, ['logs', 'log'], a.reference_id);
      const cid = log ? (log.campaignid ?? log.campaign ?? log.campaignId) : null;
      if (cid == null) unresolved.sends++;
      const e = get(cid);
      if (e.sent == null || (d != null && d < e.sent)) { e.sent = d; e.sentDate = isoDay(a.tstamp); }
    } else if (type === 'LinkData') {
      const ld = pick(idx, ['linkData', 'linkDatas', 'link_data'], a.reference_id);
      const link = pick(idx, ['links', 'link'], ld ? (ld.link ?? ld.linkid ?? ld.linkId) : null) || pick(idx, ['links', 'link'], a.reference_id);
      const cid = (ld && (ld.campaignid ?? ld.campaign ?? ld.campaignId)) ?? (link && (link.campaignid ?? link.campaign ?? link.campaignId)) ?? null;
      const url = link ? String(link.link || link.url || '') : '';
      if (!link) unresolved.clicks++;
      const e = get(cid);
      const label = link ? (link.name && link.name !== url ? String(link.name) : shortUrl(url)) : 'Link #' + a.reference_id;
      if (!e.clicks.some(c => c.label === label)) e.clicks.push({ label, url, topics: topicsFor(url || label) });
    }
  }
  const emails = Array.from(byCampaign.values()).map(e => {
    e.topics = topicsFor(e.campaign, { fallbackSlug: false });
    return e;
  }).sort((a, b) => (a.sent ?? 999) - (b.sent ?? 999));
  return { emails, stats: { activities: acts.length, campaigns: emails.length, unresolved } };
}

function shortUrl(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return u || 'link'; }
}

/* ---------- Opens: v1 campaign_report_open_list (per campaign) ---------- */
// UNVERIFIED shape. Legacy v1 JSON returns numbered keys ("0", "1", ...) plus result_code/result_message.
// Rows are expected to carry `subscriberid` and/or `email`, and `times` (open count). Parsed defensively.
export function parseOpenList(resp) {
  const rows = [];
  if (!resp || typeof resp !== 'object') return { ok: false, rows };
  if (String(resp.result_code) === '0') return { ok: true, rows }; // v1 "no results" is result_code 0 on some accounts
  for (const [k, v] of Object.entries(resp)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    rows.push({
      subscriberid: v.subscriberid != null ? String(v.subscriberid) : (v.id != null ? String(v.id) : null),
      email: String(v.email || '').toLowerCase(),
      times: Number(v.times ?? v.opens ?? v.count ?? 1) || 1,
      tstamp: v.tstamp || v.last_open || null
    });
  }
  return { ok: true, rows };
}
export function opensFor(rows, { contactId, email }) {
  const r = rows.find(x => (contactId && x.subscriberid === String(contactId)) || (email && x.email === email));
  return r ? r.times : 0;
}
