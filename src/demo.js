/**
 * Demo data source (used when DEMO_MODE=true or ActiveCampaign credentials are missing).
 * The five fictional leads live in public/demo-data.js, shared with the browser-only /demo page,
 * so the server demo and the browser demo can never drift apart.
 * Same interface and lead shape as src/ac/index.js.
 */
import { config } from './config.js';
import '../public/demo-data.js';

const D = globalThis.LNC_DEMO;
const source = D.create({
  site: config.ac.siteDomain,
  connectNote: 'AC_API_URL / AC_API_KEY not set',
  payloadNote: 'Demo data: ActiveCampaign is not configured on this server.'
});

export async function connect() { return source.connect(); }
export async function listLeads() { return source.listLeads(); }
export async function getLead(email) { return source.getLead(email); }
export const isDemoLead = D.isDemoLead;
