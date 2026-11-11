#!/usr/bin/env node
/**
 * Probe your real ActiveCampaign account and save raw responses, so the mappers in
 * src/ac/map.js can be checked against real field names (nothing is guessed).
 *
 *   npm run probe -- --email someone@yourlist.com
 *
 * Writes probe-output/NN-name.json (gitignored: it contains contact data) and prints the
 * top-level keys plus the keys of the first item of each array, then what the mappers produce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { ACClient } from '../src/ac/client.js';
import { mapContact, mapVisits, mapEmailActivity, parseOpenList, indexSideloads } from '../src/ac/map.js';

const args = process.argv.slice(2);
const email = (args[args.indexOf('--email') + 1] || '').trim().toLowerCase();
if (!config.ac.url || !config.ac.key) { console.error('Set AC_API_URL and AC_API_KEY in .env first.'); process.exit(1); }
if (!email || !email.includes('@')) { console.error('Usage: npm run probe -- --email someone@yourlist.com'); process.exit(1); }

const ac = new ACClient({ url: config.ac.url, key: config.ac.key, rps: 3 });
const outDir = path.resolve('probe-output');
fs.mkdirSync(outDir, { recursive: true });
let n = 0;

function shapeOf(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (Array.isArray(v)) out[k] = `array(${v.length})` + (v[0] && typeof v[0] === 'object' ? ' first keys: ' + Object.keys(v[0]).join(', ') : '');
    else if (v && typeof v === 'object') out[k] = 'object keys: ' + Object.keys(v).slice(0, 25).join(', ');
    else out[k] = typeof v;
  }
  return out;
}
async function probe(name, fn) {
  const file = path.join(outDir, String(++n).padStart(2, '0') + '-' + name + '.json');
  try {
    const r = await fn();
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
    console.log(`\n✓ ${name}  → ${path.relative(process.cwd(), file)}`);
    console.log(shapeOf(r));
    return r;
  } catch (e) {
    fs.writeFileSync(file, JSON.stringify({ error: e.message, status: e.status, body: e.body }, null, 2));
    console.log(`\n✗ ${name}: ${e.message}`);
    return null;
  }
}

await probe('users-me', () => ac.v3('/users/me'));
const list = await probe('contacts-by-email', () => ac.v3('/contacts', { email }));
const c = list && list.contacts && list.contacts[0];
if (!c) { console.log('\nNo contact found for', email); process.exit(0); }
const id = c.id;

const contact = await probe('contact', () => ac.v3('/contacts/' + id));
const logs = await probe('tracking-logs', () => ac.v3(`/contacts/${id}/trackingLogs`));
const acts = await probe('activities', () => ac.v3('/activities', { contact: id, include: 'reference.log.campaign,reference.link', 'orders[tstamp]': 'desc', limit: 100 }));
await probe('activities-no-include', () => ac.v3('/activities', { contact: id, 'orders[tstamp]': 'desc', limit: 20 }));
await probe('campaigns-recent', () => ac.v3('/campaigns', { limit: 5, 'orders[sdate]': 'DESC' }));

if (contact && contact.deals && contact.deals[0] && contact.deals[0].stage) await probe('deal-stage', () => ac.v3('/dealStages/' + contact.deals[0].stage));
if (contact && contact.contactTags && contact.contactTags[0]) await probe('tag', () => ac.v3('/tags/' + contact.contactTags[0].tag));

// First campaign id we can find, for the opens report.
let campaignId = null;
if (acts) {
  const idx = indexSideloads(acts, ['activities']);
  for (const m of Object.values(idx)) for (const x of m.values()) { const v = x.campaignid ?? x.campaign; if (v && /^\d+$/.test(String(v))) { campaignId = String(v); break; } }
}
if (campaignId) {
  const o = await probe('v1-open-list-campaign-' + campaignId, () => ac.v1('campaign_report_open_list', { campaignid: campaignId }));
  if (o) console.log('parseOpenList →', JSON.stringify(parseOpenList(o)).slice(0, 400));
} else console.log('\n· No campaign id found in the activity sideloads; check 05-activities.json for where the campaign id lives.');

console.log('\n——— What the mappers produce from these responses ———');
if (contact) console.log('mapContact →', JSON.stringify(mapContact(contact, { titleFieldId: config.ac.titleFieldId, companyFieldId: config.ac.companyFieldId }), (k, v) => k === 'deals' ? `[${v.length} deals]` : v, 2));
if (logs) console.log('mapVisits →', JSON.stringify(mapVisits(logs, { siteDomain: config.ac.siteDomain, windowDays: 365 }), null, 2).slice(0, 2500));
if (acts) console.log('mapEmailActivity →', JSON.stringify(mapEmailActivity(acts, { windowDays: 365 }), null, 2).slice(0, 2500));
console.log(`\nDone. ${ac.calls} API calls. Raw files are in ${path.relative(process.cwd(), outDir)}/ (gitignored).`);
