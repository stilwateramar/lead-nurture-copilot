/**
 * Minimal ActiveCampaign HTTP client.
 * - v3 REST: {AC_API_URL}/api/3/...  with header `Api-Token`.
 * - v1 legacy: {AC_API_URL}/admin/api.php?api_action=...&api_key=...&api_output=json
 * - Throttled (ActiveCampaign allows 5 requests/second per account), one retry on 429.
 * - Never logs the API key or full v1 URLs.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ACError extends Error {
  constructor(status, where, body) {
    const pub = status === 401 || status === 403
      ? 'ActiveCampaign rejected the API key (check AC_API_URL and AC_API_KEY)'
      : status === 404 ? 'Not found in ActiveCampaign'
      : status === 429 ? 'ActiveCampaign rate limit hit, try again in a minute'
      : status ? `ActiveCampaign returned HTTP ${status}` : 'Could not reach ActiveCampaign';
    super(`${pub} (${where})`);
    this.status = status;
    this.where = where;
    this.body = body;
    this.publicMessage = pub;
  }
}

export class ACClient {
  #chain = Promise.resolve();
  #last = 0;

  constructor({ url, key, rps = 4, timeoutMs = 20000 }) {
    if (!url || !key) throw new Error('ACClient needs url and key');
    this.url = url;
    this.key = key;
    this.gap = Math.ceil(1000 / rps);
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  #slot() {
    const p = this.#chain.then(async () => {
      const wait = this.#last + this.gap - Date.now();
      if (wait > 0) await sleep(wait);
      this.#last = Date.now();
    });
    this.#chain = p;
    return p;
  }

  async #fetchJson(url, headers, where, attempt = 0) {
    await this.#slot();
    this.calls++;
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new ACError(0, where, String(e.message || e));
    }
    if (res.status === 429 && attempt < 2) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (attempt + 1));
      return this.#fetchJson(url, headers, where, attempt + 1);
    }
    const text = await res.text();
    if (!res.ok) throw new ACError(res.status, where, text.slice(0, 500));
    try { return text ? JSON.parse(text) : {}; }
    catch { throw new ACError(res.status, where, 'Non-JSON response: ' + text.slice(0, 200)); }
  }

  /** GET a v3 path, e.g. v3('/contacts', { email: 'a@b.com' }). */
  v3(path, params = {}) {
    const u = new URL(this.url + '/api/3' + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return this.#fetchJson(u, { 'Api-Token': this.key, Accept: 'application/json' }, 'GET /api/3' + path);
  }

  /** GET a v1 action, e.g. v1('campaign_report_open_list', { campaignid: 12 }). */
  v1(action, params = {}) {
    const u = new URL(this.url + '/admin/api.php');
    u.searchParams.set('api_action', action);
    u.searchParams.set('api_key', this.key);
    u.searchParams.set('api_output', 'json');
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return this.#fetchJson(u, { Accept: 'application/json' }, 'v1 ' + action);
  }
}
