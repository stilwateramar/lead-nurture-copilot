/**
 * Server-side email drafting with Claude (Anthropic API directly, or via OpenRouter).
 * The prompt rules are fixed here, on the server, so the browser can't loosen them:
 *  - only the supplied facts; no invented metrics, client names, dates or links
 *  - never say or imply the lead was tracked
 * After generation, the draft is checked: any URL not in the facts, or tracking language,
 * rejects the draft and the browser falls back to the template.
 */
import { config, llmAvailable } from './config.js';

export function buildPrompt(facts) {
  return 'Write a short B2B nurture email from the sender to the lead.\n' +
    'Rules:\n- Use only the facts in the JSON below. Do not invent results, metrics, client names, dates or links.\n' +
    '- Never say or imply that you tracked their website visits or email opens. Refer to their interest naturally, e.g. "since you\'ve been exploring X".\n' +
    '- Reference the case study and the LinkedIn post if present, using their links exactly as given (keep any [placeholder] as is).\n' +
    '- One call to action that fits recommendedAction. Include the booking link only if the grade is hot.\n' +
    '- Body under 140 words, plain text, no markdown, sign off with the sender\'s name and company on separate lines.\n' +
    'Return JSON only: {"subject": string, "body": string, "why": string (one sentence for the sender explaining the angle)}.\n\n' +
    'Facts:\n' + JSON.stringify(facts, null, 2);
}

const TRACKING_TALK = /\b(we|i)\s+(noticed|saw|see|tracked|could see)\b[^.]{0,60}\b(visit|visited|opened|clicked|browsing|pages?)\b|\btrack(ed|ing)\b[^.]{0,40}\b(you|your)\b|\byou\s+(visited|opened|clicked)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

function allowedLinks(facts) {
  const s = new Set();
  const add = v => { if (typeof v === 'string' && /^https?:\/\//i.test(v)) s.add(v.replace(/[.,;:]+$/, '')); };
  add(facts?.caseStudy?.link); add(facts?.linkedinPost?.link); add(facts?.bookingLink);
  return s;
}

export function checkDraft(d, facts) {
  if (!d || typeof d.subject !== 'string' || typeof d.body !== 'string' || !d.body.trim()) return 'unexpected_format';
  const ok = allowedLinks(facts);
  const urls = (d.subject + '\n' + d.body).match(URL_RE) || [];
  if (urls.some(u => !ok.has(u.replace(/[.,;:]+$/, '')))) return 'invented_link';
  if (TRACKING_TALK.test(d.subject + '\n' + d.body)) return 'tracking_language';
  return null;
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function callAnthropic(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.llm.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.llm.anthropicModel, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Anthropic HTTP ' + r.status); e.code = r.status === 429 ? 'rate_limited' : 'llm_error'; throw e; }
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callOpenRouter(prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + config.llm.openrouterKey, 'content-type': 'application/json', 'X-Title': 'Lead Nurture Copilot' },
    body: JSON.stringify({ model: config.llm.openrouterModel, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'OpenRouter HTTP ' + r.status); e.code = r.status === 429 ? 'rate_limited' : 'llm_error'; throw e; }
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}

export function llmStatus() {
  return { available: llmAvailable(), provider: config.llm.provider, model: config.llm.provider === 'openrouter' ? config.llm.openrouterModel : config.llm.anthropicModel };
}

/** Returns { ok:true, draft } or { ok:false, code, message }. */
export async function draftEmail(facts) {
  if (!llmAvailable()) return { ok: false, code: 'not_configured', message: 'No Claude API key is set on the server.' };
  const prompt = buildPrompt(facts);
  try {
    const text = config.llm.provider === 'openrouter' ? await callOpenRouter(prompt) : await callAnthropic(prompt);
    const d = parseJson(text);
    const bad = checkDraft(d, facts);
    if (bad) return { ok: false, code: bad, message: bad === 'invented_link' ? 'Claude added a link that is not in your content.' : bad === 'tracking_language' ? 'Claude mentioned tracking, which the rules forbid.' : 'Claude returned an unexpected format.' };
    return { ok: true, draft: { subject: d.subject.trim(), body: d.body.trim(), why: String(d.why || '').trim() } };
  } catch (e) {
    return { ok: false, code: e.code || 'llm_error', message: e.message };
  }
}
