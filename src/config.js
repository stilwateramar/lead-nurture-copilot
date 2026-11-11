import 'dotenv/config';

const bool = v => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const num = (v, d, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};

const acUrl = String(process.env.AC_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api\/3$/, '');
const acKey = String(process.env.AC_API_KEY || '').trim();

const provider = String(process.env.LLM_PROVIDER || (process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY ? 'openrouter' : 'anthropic')).toLowerCase();

export const config = {
  port: num(process.env.PORT, 3000, 1, 65535),
  isProd: process.env.NODE_ENV === 'production',

  // Demo mode: on when DEMO_MODE=true, or when ActiveCampaign credentials are missing.
  demo: bool(process.env.DEMO_MODE) || !(acUrl && acKey),

  ac: {
    url: acUrl,                       // e.g. https://youraccount.api-us1.com
    key: acKey,
    siteDomain: String(process.env.SITE_DOMAIN || 'akdaisolutions.com').trim(),
    leadTagId: String(process.env.AC_LEAD_TAG_ID || '').trim(),   // optional: only list contacts with this tag id
    leadListId: String(process.env.AC_LEAD_LIST_ID || '').trim(), // optional: only list contacts on this list id
    maxLeads: num(process.env.AC_MAX_LEADS, 25, 1, 100),
    windowDays: num(process.env.ACTIVITY_WINDOW_DAYS, 30, 1, 365),
    opensSource: String(process.env.AC_OPENS_SOURCE || 'v1').toLowerCase(), // 'v1' | 'off'
    rps: num(process.env.AC_RPS, 4, 1, 5),                                 // ActiveCampaign allows 5 req/s per account
    titleFieldId: String(process.env.AC_FIELD_TITLE_ID || '').trim(),     // optional custom field id for job title
    companyFieldId: String(process.env.AC_FIELD_COMPANY_ID || '').trim(), // optional custom field id for company
    cacheSeconds: num(process.env.AC_CACHE_SECONDS, 300, 0, 3600)
  },

  llm: {
    provider: provider === 'openrouter' ? 'openrouter' : 'anthropic',
    anthropicKey: String(process.env.ANTHROPIC_API_KEY || '').trim(),
    anthropicModel: String(process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim(),
    openrouterKey: String(process.env.OPENROUTER_API_KEY || '').trim(),
    openrouterModel: String(process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5.5').trim()
  },

  sender: {
    name: String(process.env.SENDER_NAME || 'Amar Kumar Dani'),
    company: String(process.env.SENDER_COMPANY || 'AKD AI Solutions'),
    booking: String(process.env.SENDER_BOOKING_URL || '')
  },

  auth: {
    user: String(process.env.APP_USER || 'admin'),
    password: String(process.env.APP_PASSWORD || '')
  },

  contentDir: String(process.env.CONTENT_DIR || 'content')
};

export function llmAvailable() {
  const l = config.llm;
  return l.provider === 'openrouter' ? !!l.openrouterKey : !!l.anthropicKey;
}
