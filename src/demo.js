/**
 * Demo data source (used when DEMO_MODE=true or ActiveCampaign credentials are missing).
 * Five fictional leads with .example emails, carried over from the artifact version.
 * Same interface and lead shape as src/ac/index.js.
 */
import { config } from './config.js';
import { createLog } from './log.js';

const DAY = 864e5;
const iso = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const SITE = config.ac.siteDomain;

const RAW = [
  { contactId: '48213', name: 'Rachel Okafor', email: 'rachel@brightline-growth.example', title: 'Founder & CEO', company: 'Brightline Growth Co.', location: 'Austin, US',
    tags: ['agency', 'us-market', 'webinar-oct'], stage: 'Qualified · discovery call pending', source: 'Lemlist outbound, replied',
    visits: [
      { path: '/pricing', title: 'Pricing', topics: ['pricing'], daysAgo: 1, count: 2, secs: 70 },
      { path: '/case-studies/ai-performance-marketing-optimizer', title: 'Case study: AI performance-marketing optimizer', topics: ['performance marketing', 'budget allocation', 'google ads', 'meta ads'], daysAgo: 1, count: 2, secs: 155 },
      { path: '/contact', title: 'Contact', topics: ['contact'], daysAgo: 1, count: 1, secs: 35 },
      { path: '/services/ai-for-agencies', title: 'AI for agencies', topics: ['agency', 'performance marketing', 'automation'], daysAgo: 3, count: 3, secs: 73 },
      { path: '/blog/agency-reporting-automation', title: 'Blog: Automating agency client reporting', topics: ['reporting', 'automation', 'agency'], daysAgo: 6, count: 1, secs: 180 }
    ],
    emails: [
      { campaign: 'Agency AI playbook #2', subject: '3 AI workflows agencies are shipping this quarter', sent: 4, opens: 4, clicks: [{ label: 'Performance-marketing optimizer case study', topics: ['performance marketing', 'budget allocation'] }], topics: ['agency', 'automation'] },
      { campaign: 'Monthly AI notes · Oct', subject: 'What we built in October', sent: 12, opens: 1, clicks: [], topics: ['automation'] },
      { campaign: 'Agency AI playbook #1', subject: 'Where agencies lose hours every week', sent: 19, opens: 2, clicks: [{ label: 'Client reporting automation post', topics: ['reporting', 'automation'] }], topics: ['reporting', 'agency'] }
    ] },
  { contactId: '48377', name: 'Priya Menon', email: 'priya.menon@northpeak-logistics.example', title: 'Director of Operations', company: 'Northpeak Logistics', location: 'Bengaluru, IN',
    tags: ['enterprise', 'india', 'ops'], stage: 'Lead · engaged', source: 'Website form, training guide download',
    visits: [
      { path: '/case-studies/logistics-lms', title: 'Case study: Mobile-first LMS for logistics', topics: ['lms', 'training', 'logistics'], daysAgo: 2, count: 3, secs: 140 },
      { path: '/pricing', title: 'Pricing', topics: ['pricing'], daysAgo: 2, count: 1, secs: 95 },
      { path: '/services/custom-software', title: 'Custom software development', topics: ['custom software'], daysAgo: 2, count: 1, secs: 60 },
      { path: '/blog/mobile-first-training', title: 'Blog: Training frontline staff on mobile', topics: ['training', 'lms'], daysAgo: 8, count: 1, secs: 210 }
    ],
    emails: [
      { campaign: 'Ops & training notes', subject: 'Why frontline training fails (and what fixes it)', sent: 5, opens: 3, clicks: [{ label: 'Logistics LMS case study', topics: ['lms', 'training', 'logistics'] }], topics: ['training'] },
      { campaign: 'Monthly AI notes · Oct', subject: 'What we built in October', sent: 12, opens: 0, clicks: [], topics: [] }
    ] },
  { contactId: '48402', name: 'Daniel Whitford', email: 'daniel@harbourline.example', title: 'Head of SEO', company: 'Harbourline Digital', location: 'Perth, AU',
    tags: ['agency', 'au-market'], stage: 'Lead · nurture', source: 'Google Maps scrape → Lemlist',
    visits: [
      { path: '/blog/keyword-gap-analysis', title: 'Blog: What a keyword-gap tool checks', topics: ['seo', 'keyword research'], daysAgo: 5, count: 2, secs: 130 },
      { path: '/case-studies/seo-keyword-gap-tool', title: 'Case study: SEO keyword-gap tool', topics: ['seo', 'keyword research', 'agency'], daysAgo: 5, count: 1, secs: 190 },
      { path: '/', title: 'Home', topics: [], daysAgo: 9, count: 1, secs: 40 }
    ],
    emails: [
      { campaign: 'Agency AI playbook #2', subject: '3 AI workflows agencies are shipping this quarter', sent: 4, opens: 2, clicks: [{ label: 'Keyword-gap analysis post', topics: ['seo', 'keyword research'] }], topics: ['agency'] },
      { campaign: 'Monthly AI notes · Oct', subject: 'What we built in October', sent: 12, opens: 1, clicks: [], topics: [] }
    ] },
  { contactId: '48455', name: 'Jason Reyes', email: 'jason@tidewater-studio.example', title: 'Creative Director', company: 'Tidewater Studio', location: 'San Diego, US',
    tags: ['agency', 'creative', 'us-market'], stage: 'Lead · nurture', source: 'LinkedIn post engagement',
    visits: [
      { path: '/services/ai-content-production', title: 'AI content production', topics: ['creative', 'content production'], daysAgo: 4, count: 2, secs: 95 },
      { path: '/blog/human-in-the-loop-creative', title: 'Blog: Where people stay in the loop', topics: ['creative', 'image generation'], daysAgo: 4, count: 1, secs: 160 },
      { path: '/case-studies/d2c-product-imagery', title: 'Case study: AI product imagery for a D2C brand', topics: ['image generation', 'ecommerce', 'creative'], daysAgo: 10, count: 1, secs: 120 }
    ],
    emails: [
      { campaign: 'Creative AI notes', subject: "AI creative pipelines that don't look AI-made", sent: 7, opens: 2, clicks: [{ label: 'Human-in-the-loop creative post', topics: ['creative', 'content production'] }], topics: ['creative'] },
      { campaign: 'Monthly AI notes · Oct', subject: 'What we built in October', sent: 12, opens: 0, clicks: [], topics: [] }
    ] },
  { contactId: '48501', name: 'Omar Al-Sayed', email: 'omar@dunecraft-media.example', title: 'Managing Partner', company: 'Dunecraft Media', location: 'Dubai, UAE',
    tags: ['agency', 'me-market'], stage: 'Lead · cold', source: 'Google Maps scrape → Lemlist',
    visits: [{ path: '/', title: 'Home', topics: [], daysAgo: 17, count: 1, secs: 25 }],
    emails: [
      { campaign: 'Agency AI playbook #1', subject: 'Where agencies lose hours every week', sent: 19, opens: 1, clicks: [], topics: ['agency', 'reporting'] },
      { campaign: 'Agency AI playbook #2', subject: '3 AI workflows agencies are shipping this quarter', sent: 4, opens: 0, clicks: [], topics: ['agency', 'automation'] },
      { campaign: 'Monthly AI notes · Oct', subject: 'What we built in October', sent: 12, opens: 0, clicks: [], topics: [] }
    ] }
];

function shape(r) {
  const lead = {
    id: 'demo-' + r.contactId, contactId: r.contactId, name: r.name, email: r.email, title: r.title, company: r.company, companyIsDomain: false,
    domain: r.email.split('@')[1], location: r.location, tags: r.tags, stage: r.stage, source: r.source,
    visits: r.visits.map(v => ({ ...v, url: 'https://' + SITE + v.path, lastVisit: iso(v.daysAgo) })),
    emails: r.emails.map((e, i) => ({ campaignId: 'demo-' + i, ...e, sentDate: iso(e.sent), clicks: e.clicks.map(c => ({ url: '', ...c })) })),
    dataNotes: { opens: 'demo', visitTime: 'demo', windowDays: 30 },
    demo: true
  };
  const parts = r.name.split(' ');
  const payload = {
    _demo: 'Demo data: ActiveCampaign is not configured on this server.',
    contact: { id: r.contactId, email: r.email, firstName: parts[0], lastName: parts.slice(1).join(' '), title: r.title, organization: r.company, location: r.location, tags: r.tags, dealStage: r.stage, source: r.source },
    siteTracking: { domain: SITE, window: '30d', visits: lead.visits.map(v => ({ url: v.url, pageTitle: v.title, views: v.count, avgSeconds: v.secs, lastVisit: v.lastVisit })) },
    emailActivity: lead.emails.map(e => ({ campaign: e.campaign, subject: e.subject, sentDate: e.sentDate, opens: e.opens, clicks: e.clicks.map(c => c.label) }))
  };
  return { lead, payload };
}

export async function connect() {
  const log = createLog();
  log.info('Demo mode', 'AC_API_URL / AC_API_KEY not set');
  return { connected: true, mode: 'demo', account: 'demo', user: '', siteDomain: SITE, log: log.entries };
}

export async function listLeads() {
  const log = createLog();
  log.ok('Retrieved contacts', RAW.length + ' demo leads');
  return { leads: RAW.map(r => shape(r).lead), log: log.entries, fetchedAt: new Date().toISOString() };
}

export async function getLead(email) {
  const log = createLog();
  log.info('Lead: ' + email);
  const r = RAW.find(x => x.email.toLowerCase() === email);
  if (!r) { log.fail('Looking up contact by email', 'no contact'); return { notFound: true, log: log.entries }; }
  const { lead, payload } = shape(r);
  log.ok('Looked up contact by email', '#' + r.contactId);
  log.ok('Read contact fields and deal stage', r.stage);
  log.ok('Read site-tracking visits', lead.visits.reduce((t, v) => t + v.count, 0) + ' page views');
  log.ok('Read email campaign activity', `${lead.emails.length} campaigns · ${lead.emails.reduce((t, e) => t + e.opens, 0)} opens · ${lead.emails.reduce((t, e) => t + e.clicks.length, 0)} clicks`);
  return { lead, payload, log: log.entries };
}
