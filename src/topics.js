import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ActiveCampaign site tracking records URLs only (no page titles, no topics).
 * Topics and page titles are derived from the URL with config/topics.json, which you can edit.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'config', 'topics.json');

let cfg = { rules: [], titlePrefixes: {}, ignoreSegments: [] };
try { cfg = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) { console.warn('[topics] could not read config/topics.json:', e.message); }

const deslug = s => decodeURIComponent(String(s || '')).replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/** Topics for any text: a URL path, a link URL or a campaign name. */
export function topicsFor(text, { fallbackSlug = true } = {}) {
  const t = String(text || '').toLowerCase();
  const out = new Set();
  for (const r of cfg.rules || []) {
    const ms = Array.isArray(r.match) ? r.match : [r.match];
    if (ms.some(m => m && t.includes(String(m).toLowerCase()))) (r.topics || []).forEach(x => out.add(x));
  }
  if (!out.size && fallbackSlug) {
    let p = t;
    try { p = new URL(t).pathname; } catch {}
    const segs = p.split(/[/?#]/).filter(Boolean).filter(s => !(cfg.ignoreSegments || []).includes(s));
    const last = segs[segs.length - 1];
    if (last && !/^\d+$/.test(last)) out.add(deslug(last).toLowerCase());
  }
  return Array.from(out);
}

/** Human page title from a path: "/case-studies/logistics-lms" -> "Case study: Logistics lms". */
export function titleFor(p) {
  const pathOnly = String(p || '/').split(/[?#]/)[0] || '/';
  if (pathOnly === '/' || pathOnly === '') return 'Home';
  for (const [prefix, label] of Object.entries(cfg.titlePrefixes || {})) {
    if (pathOnly.startsWith(prefix) && pathOnly.length > prefix.length) {
      return label + cap(deslug(pathOnly.slice(prefix.length).split('/').filter(Boolean).pop()));
    }
  }
  const segs = pathOnly.split('/').filter(Boolean);
  return cap(deslug(segs[segs.length - 1] || 'Home'));
}
