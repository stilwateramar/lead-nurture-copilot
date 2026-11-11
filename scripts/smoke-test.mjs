#!/usr/bin/env node
/**
 * Offline checks (no network): mappers against fixture shapes, and the draft guard.
 *   npm run check
 * The fixtures below use the field names ActiveCampaign documents plus the guessed ones
 * marked UNVERIFIED in src/ac/map.js. Replace them with real probe-output once you have it.
 */
import assert from 'node:assert/strict';
import { mapContact, mapVisits, mapEmailActivity, parseOpenList, opensFor, dealStageLabel } from '../src/ac/map.js';
import { checkDraft } from '../src/llm.js';

const now = Date.parse('2026-11-11T10:00:00Z');
const daysBack = d => new Date(now - d * 864e5).toISOString();

// Contact
const c = mapContact({ contact: { id: '7', email: 'A@B.com', firstName: 'Ann', lastName: 'Lee' }, deals: [{ id: '1', stage: '3', status: '0' }], contactTags: [{ tag: '9' }], fieldValues: [{ field: '12', value: 'CTO' }] }, { titleFieldId: '12' });
assert.equal(c.email, 'a@b.com'); assert.equal(c.name, 'Ann Lee'); assert.equal(c.title, 'CTO'); assert.deepEqual(c.contactTagIds, ['9']);
assert.equal(dealStageLabel(c.deals, { 3: 'Qualified' }), 'Qualified · open');

// Visits
const v = mapVisits({ trackingLogs: [
  { id: '1', type: '__pagevisit', value: 'https://akdaisolutions.com/pricing', tstamp: daysBack(1) },
  { id: '2', type: '__pagevisit', value: 'https://akdaisolutions.com/pricing/', tstamp: daysBack(3) },
  { id: '3', type: '__pagevisit', value: 'https://akdaisolutions.com/case-studies/logistics-lms', tstamp: daysBack(2) },
  { id: '4', type: '__pagevisit', value: 'https://other.com/x', tstamp: daysBack(1) },
  { id: '5', type: '__redir', value: 'https://akdaisolutions.com/y', tstamp: daysBack(1) },
  { id: '6', type: '__pagevisit', value: 'https://akdaisolutions.com/old', tstamp: daysBack(90) }
] }, { siteDomain: 'akdaisolutions.com', windowDays: 30, now });
assert.equal(v.visits.length, 2);
assert.equal(v.visits.find(x => x.path === '/pricing').count, 2);
assert.equal(v.visits.find(x => x.path === '/pricing').daysAgo, 1);
assert.ok(v.visits.find(x => x.path === '/case-studies/logistics-lms').topics.includes('lms'));
assert.equal(v.stats.otherDomain, 1); assert.equal(v.stats.skippedOld, 1);

// Activities (sideload key names are UNVERIFIED guesses)
const e = mapEmailActivity({
  activities: [
    { id: 'a1', tstamp: daysBack(4), reference_type: 'Log', reference_id: '10' },
    { id: 'a2', tstamp: daysBack(3), reference_type: 'LinkData', reference_id: '20' },
    { id: 'a3', tstamp: daysBack(3), reference_type: 'MppLinkData', reference_id: '21' }
  ],
  logs: [{ id: '10', campaignid: '5' }],
  linkData: [{ id: '20', link: '30', campaignid: '5' }],
  links: [{ id: '30', link: 'https://akdaisolutions.com/case-studies/seo-keyword-gap-tool', name: '' }],
  campaigns: [{ id: '5', name: 'Agency AI playbook #2' }]
}, { windowDays: 30, now });
assert.equal(e.emails.length, 1);
assert.equal(e.emails[0].campaign, 'Agency AI playbook #2');
assert.equal(e.emails[0].sent, 4);
assert.equal(e.emails[0].clicks.length, 1);
assert.ok(e.emails[0].clicks[0].topics.includes('seo'));

// Opens (v1 shape UNVERIFIED)
const o = parseOpenList({ 0: { subscriberid: '7', email: 'a@b.com', times: '3' }, result_code: 1 });
assert.equal(opensFor(o.rows, { contactId: '7' }), 3);
assert.equal(opensFor(o.rows, { contactId: '8', email: 'x@y.z' }), 0);

// Draft guard
const facts = { caseStudy: { link: 'https://akdaisolutions.com/cs' }, linkedinPost: null, bookingLink: '[your booking link]' };
assert.equal(checkDraft({ subject: 's', body: 'See https://akdaisolutions.com/cs.' }, facts), null);
assert.equal(checkDraft({ subject: 's', body: 'See https://made-up.com/x' }, facts), 'invented_link');
assert.equal(checkDraft({ subject: 's', body: 'I noticed you visited our pricing page.' }, facts), 'tracking_language');
assert.equal(checkDraft({ subject: 's', body: "Since you've been exploring SEO, here is a read." }, facts), null);
assert.equal(checkDraft({ body: 'x' }, facts), 'unexpected_format');

// Demo source (shared by the server and the browser-only /demo page)
const demo = await import('../src/demo.js');
const dl = await demo.listLeads();
assert.equal(dl.leads.length, 5);
assert.ok(dl.leads.every(l => l.email.endsWith('.example') && l.demo === true));
const dg = await demo.getLead('priya.menon@northpeak-logistics.example');
assert.equal(dg.lead.name, 'Priya Menon'); assert.ok(dg.payload._demo); assert.ok(dg.log.length >= 4);
assert.equal((await demo.getLead('nobody@x.com')).notFound, true);
assert.equal(demo.isDemoLead({ firstName: 'Priya', company: 'Northpeak Logistics' }), true);
assert.equal(demo.isDemoLead({ firstName: 'Priya', company: 'Acme' }), false);
assert.equal(demo.isDemoLead(null), false);

// Session cookie: valid after sign-in, invalid when the password changes or the cookie is tampered with
const { startSession, hasSession, checkCredentials } = await import('../src/auth.js');
const auth = { user: 'admin', password: 'pw-1' };
const cookies = []; startSession({ append: (k, v) => cookies.push(v) }, auth, true);
const cookie = cookies[0].split(';')[0];
assert.ok(/HttpOnly/.test(cookies[0]) && /Secure/.test(cookies[0]) && /SameSite=Lax/.test(cookies[0]));
assert.equal(hasSession({ headers: { cookie } }, auth), true);
assert.equal(hasSession({ headers: { cookie } }, { user: 'admin', password: 'pw-2' }), false);
assert.equal(hasSession({ headers: { cookie: cookie.slice(0, -2) + 'xx' } }, auth), false);
assert.equal(hasSession({ headers: {} }, auth), false);
assert.equal(checkCredentials(auth, 'admin', 'pw-1'), true);
assert.equal(checkCredentials(auth, 'admin', 'nope'), false);
assert.equal(checkCredentials({ user: 'admin', password: '' }, 'admin', ''), false);

console.log('All checks passed.');
