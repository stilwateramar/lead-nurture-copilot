/* Lead Nurture Copilot: scoring, interest profile, content matching, template email, content parsing.
   Ported from the artifact version (build/segments.js) and made tolerant of missing live data
   (no visit dates, no time on page, opens unavailable). Exposed as window.LNC. */
(function () {
  "use strict";
  const DAY = 864e5;
  const ago = d => d == null ? "date unknown" : d === 0 ? "today" : d === 1 ? "yesterday" : d + " days ago";
  const dateOf = d => d == null ? "—" : new Date(Date.now() - d * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
  const listJoin = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const firstName = l => String(l.name || l.email || "there").split(" ")[0];

  /* ---------- Sample content repository (replace with your own) ---------- */
  const SAMPLE_REPO = [
    { type: "case_study", title: "AI performance-marketing optimizer for agency clients", tags: ["performance marketing", "budget allocation", "google ads", "meta ads", "agency", "automation"], summary: "Agents read Google Ads and Meta performance, propose budget shifts between campaigns, flag weak keywords and audiences, and draft creative tests for the account team to approve." },
    { type: "case_study", title: "SEO keyword-gap tool for an SEO agency", tags: ["seo", "keyword research", "agency", "automation"], summary: "Compares a client site with competitors, groups the keywords competitors rank for that the client does not, and turns the gaps into a prioritised content brief." },
    { type: "case_study", title: "Plain-English analytics on MongoDB transaction data", tags: ["analytics", "natural language", "reporting", "dashboard"], summary: "Ops teams ask questions in plain language; the assistant writes the MongoDB query, runs it, and returns a chart with a short answer." },
    { type: "case_study", title: "Mobile-first LMS for a logistics company", tags: ["lms", "training", "logistics", "custom software"], summary: "A learning platform for drivers and warehouse staff, built from the client's BRD and brand guidelines: courses, quizzes, progress tracking and admin reports." },
    { type: "case_study", title: "RAG chatbot for sports-club fan engagement", tags: ["rag", "chatbot", "community", "fan engagement"], summary: "A fan-facing assistant that answers questions from club content, fixtures and FAQs, grounded in retrieved sources." },
    { type: "case_study", title: "AI product-imagery pipeline for a D2C perfume brand", tags: ["creative", "image generation", "ecommerce", "content production"], summary: "A script that composites product photos into on-brand combo shots, so the marketing team gets campaign visuals without a new shoot." },
    { type: "linkedin_post", title: "Agencies don't need another dashboard. They need the next decision.", tags: ["performance marketing", "agency", "budget allocation", "reporting"], summary: "Why we built optimizer agents that propose a budget move with a reason attached, instead of adding more charts." },
    { type: "linkedin_post", title: "What a keyword-gap tool actually checks", tags: ["seo", "keyword research"], summary: "A walk-through of the signals that matter when you compare a site against its competitors." },
    { type: "linkedin_post", title: "Ask your database a question in plain English", tags: ["analytics", "natural language", "reporting"], summary: "How natural-language querying changes who on the team can get answers from data." },
    { type: "linkedin_post", title: "Training frontline staff: why we went mobile-first", tags: ["lms", "training", "logistics"], summary: "Drivers and warehouse teams learn on their phones between shifts, so the LMS had to be designed for that." },
    { type: "linkedin_post", title: "AI creative pipelines: where people stay in the loop", tags: ["creative", "content production", "image generation"], summary: "The steps we automate in creative production and the ones we deliberately leave to designers." },
    { type: "linkedin_post", title: "Client reporting is the hidden tax on agency margins", tags: ["reporting", "automation", "agency"], summary: "Where agency hours go each month, and which reporting steps are safe to automate first." }
  ].map(x => Object.assign({ url: "", body: "", file: "sample", sample: true }, x));

  /* ---------- Scoring ---------- */
  // Recency weight. Unknown dates get the lowest weight rather than being dropped.
  const rec = d => d == null ? 0.6 : d <= 3 ? 1.5 : d <= 7 ? 1.2 : d <= 14 ? 1 : 0.6;
  function scoreLead(lead) {
    let s = 0;
    (lead.visits || []).forEach(v => {
      let p = v.count * 2;
      if (/pricing/.test(v.path)) p += 5 * v.count;
      if (/contact/.test(v.path)) p += 8;
      if (/case-stud/.test(v.path)) p += 3 * v.count;
      s += p * rec(v.daysAgo);
    });
    (lead.emails || []).forEach(e => { s += (Math.min(e.opens || 0, 5) * 1.5 + e.clicks.length * 6) * rec(e.sent); });
    s = Math.min(100, Math.round(s));
    return { s, grade: s >= 45 ? "hot" : s >= 22 ? "warm" : "cool" };
  }
  function interestProfile(lead) {
    const m = new Map();
    const add = (t, w, why) => {
      if (!t || t === "pricing" || t === "contact") return;
      const e = m.get(t) || { topic: t, w: 0, why: [] };
      e.w += w; if (why && e.why.indexOf(why) < 0) e.why.push(why);
      m.set(t, e);
    };
    (lead.visits || []).forEach(v => (v.topics || []).forEach(t => add(t, v.count * 1.5 * rec(v.daysAgo), "visited " + String(v.title).replace(/^(Case study|Blog): /, "") + " ×" + v.count)));
    (lead.emails || []).forEach(e => {
      e.clicks.forEach(c => (c.topics || []).forEach(t => add(t, 6 * rec(e.sent), "clicked “" + c.label + "”")));
      if (e.opens) (e.topics || []).forEach(t => add(t, Math.min(e.opens, 4) * 0.5 * rec(e.sent), "opened “" + (e.subject || e.campaign) + "”"));
    });
    return Array.from(m.values()).sort((a, b) => b.w - a.w);
  }
  function matchContent(profile, repo) {
    return repo.map(item => {
      const tags = (item.tags || []).map(t => t.toLowerCase());
      const title = (item.title || "").toLowerCase();
      const hay = (title + " " + (item.summary || "") + " " + (item.body || "")).toLowerCase();
      let score = 0; const hits = [];
      profile.forEach(p => {
        const t = p.topic.toLowerCase();
        let w = 0;
        if (tags.some(g => g === t || g.indexOf(t) >= 0 || t.indexOf(g) >= 0)) w = 3;
        else if (title.indexOf(t) >= 0) w = 2;
        else if (hay.indexOf(t) >= 0) w = 1;
        if (w) { score += w * p.w; hits.push(p); }
      });
      return { item, score, hits };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  }
  const known = a => a.filter(x => x != null);
  function signalsFor(lead) {
    const out = [], visits = lead.visits || [], emails = lead.emails || [];
    const pr = visits.filter(v => /pricing/.test(v.path));
    if (pr.length) { const d = known(pr.map(v => v.daysAgo)); out.push({ lvl: "hot", text: "Viewed pricing " + sum(pr, v => v.count) + "×, last seen " + ago(d.length ? Math.min.apply(null, d) : null) }); }
    const ct = visits.find(v => /contact/.test(v.path));
    if (ct) out.push({ lvl: "hot", text: "Opened the contact page " + ago(ct.daysAgo) + ", no form submission recorded" });
    visits.filter(v => /case-stud/.test(v.path)).forEach(v => out.push({ lvl: "warm", text: "Read “" + String(v.title).replace(/^Case study: /, "") + "” " + v.count + "×" + (v.secs ? " (avg " + Math.round(v.secs / 6) / 10 + " min)" : "") }));
    emails.forEach(e => e.clicks.forEach(c => out.push({ lvl: "warm", text: "Clicked “" + c.label + "” in " + e.campaign })));
    emails.filter(e => (e.opens || 0) >= 3).forEach(e => out.push({ lvl: "warm", text: "Opened “" + (e.subject || e.campaign) + "” " + e.opens + "×" }));
    if (emails.length && emails.every(e => !e.clicks.length)) out.push({ lvl: "cool", text: "No link clicks across the last " + plural(emails.length, "campaign") });
    if (!visits.length) out.push({ lvl: "cool", text: "No site visits recorded in the window" });
    else { const d = known(visits.map(v => v.daysAgo)); const last = d.length ? Math.min.apply(null, d) : null; if (last != null && last > 14) out.push({ lvl: "cool", text: "No site visit in " + last + " days" }); }
    return out;
  }
  const RECOMMEND = {
    hot: "Send a case-study email with a direct call invite now, while interest is fresh.",
    warm: "Send an educational touch: one case study and one LinkedIn post on the topic they are reading about.",
    cool: "Send a light-touch value email and hold off on asking for a call."
  };
  function analyze(lead, repo) {
    const sc = scoreLead(lead), prof = interestProfile(lead), sig = signalsFor(lead);
    const matches = matchContent(prof, repo);
    const cs = matches.find(m => m.item.type === "case_study") || null;
    const post = matches.find(m => m.item.type === "linkedin_post") || null;
    return { sc, prof, sig, matches, cs, post };
  }
  function shortSummary(lead, a) {
    const visits = lead.visits || [], emails = lead.emails || [];
    const pv = sum(visits, v => v.count), days = new Set(known(visits.map(v => v.daysAgo))).size;
    const clicks = sum(emails, e => e.clicks.length);
    const topics = a.prof.slice(0, 2).map(p => p.topic);
    const web = pv ? plural(pv, "page view") + (days ? " over " + plural(days, "day") : "") + (topics.length ? ", mostly on " + listJoin(topics) : "") + "." : "No site visits recorded.";
    let mail;
    if (!emails.length) mail = "No campaign emails in the window.";
    else if (emails.some(e => e.opens != null)) mail = "Opened " + emails.filter(e => e.opens > 0).length + " of " + plural(emails.length, "email") + ", " + plural(clicks, "click") + ".";
    else mail = plural(emails.length, "campaign") + " sent, " + plural(clicks, "click") + " (opens unavailable).";
    return web + " " + mail;
  }
  function askText(lead, a) {
    const f = firstName(lead), topic = a.prof[0] ? a.prof[0].topic : "your services";
    if (a.sc.grade === "hot") return { q: "Send " + f + " a nurture email now?", why: "Buying signals this week. Suggested: the " + (a.cs ? "“" + a.cs.item.title + "”" : "best-matching") + " case study plus a call invite." };
    if (a.sc.grade === "warm") return { q: "Send " + f + " something on " + topic + "?", why: "Researching, not ready to talk. Suggested: one case study and one LinkedIn post, no hard ask." };
    return { q: "Re-engage " + f + " with a light-touch email?", why: "Gone quiet. Suggested: one useful piece, no call request." };
  }
  const itemLink = it => it.url ? it.url : "[link: " + it.title + "]";
  const companyOf = lead => lead.company || (lead.domain ? lead.domain : "your team");

  function templateEmail(lead, a, sender) {
    const first = firstName(lead), company = companyOf(lead);
    const topic = a.prof[0] ? a.prof[0].topic : "AI for your team";
    const cs = a.cs && a.cs.item, post = a.post && a.post.item;
    const booking = sender.booking || "[your booking link]";
    const g = a.sc.grade;
    const subject = g === "hot" && cs ? "How we built it: " + cs.title : g === "warm" ? "A short read on " + topic : "Worth a look, " + first + "?";
    const L = ["Hi " + first + ",", ""];
    if (g === "hot") L.push("Since you've been looking into " + topic + ", I thought this would be useful.");
    else if (g === "warm") L.push("You've been reading about " + topic + ", so here are two short pieces that go a level deeper.");
    else L.push("A quick one with no ask attached: here's something we built recently that may be relevant to " + company + ".");
    if (cs) L.push("", cs.title, cs.summary || "", itemLink(cs));
    if (post) L.push("", "I also wrote about this on LinkedIn: “" + post.title + "”", itemLink(post));
    L.push("");
    if (g === "hot") L.push("If this is relevant for " + company + ", would a 15-minute call this week help? Pick any slot here: " + booking);
    else if (g === "warm") L.push("If any of this maps to what you're working on at " + company + ", just reply and I'll share more detail.");
    else L.push("If the timing isn't right, no problem at all.");
    L.push("", "Best,", sender.name, sender.company);
    return { subject, body: L.filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n"), why: "Template draft based on the " + g + " grade and the top content match." };
  }
  /** Facts sent to the server; the server owns the prompt rules (src/llm.js). */
  function draftFacts(lead, a, sender) {
    const cs = a.cs && a.cs.item, post = a.post && a.post.item;
    return {
      sender: { name: sender.name, company: sender.company, offering: "AI, ML and data-science services, plus software development and cybersecurity" },
      lead: { firstName: firstName(lead), title: lead.title || null, company: lead.company || null, location: lead.location || null },
      engagement: { grade: a.sc.grade, score: a.sc.s, signals: a.sig.map(s => s.text) },
      topInterests: a.prof.slice(0, 4).map(p => p.topic),
      recommendedAction: RECOMMEND[a.sc.grade],
      caseStudy: cs ? { title: cs.title, summary: cs.summary, link: itemLink(cs) } : null,
      linkedinPost: post ? { title: post.title, summary: post.summary, link: itemLink(post) } : null,
      bookingLink: sender.booking || "[your booking link]"
    };
  }

  /* ---------- Content repository parsing ---------- */
  const splitTags = v => Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : String(v || "").replace(/^\[|\]$/g, "").split(/[,;]/).map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  function inferType(path, declared) {
    const d = String(declared || "").toLowerCase();
    if (/linkedin|post/.test(d)) return "linkedin_post";
    if (/case/.test(d)) return "case_study";
    const p = path.toLowerCase();
    if (/linkedin|posts?\//.test(p) || /post/.test(p.split("/").pop())) return "linkedin_post";
    return "case_study";
  }
  const niceName = path => path.split("/").pop().replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  function parseText(text, path) {
    let fm = {}, body = text;
    const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (m) {
      body = text.slice(m[0].length);
      m[1].split(/\r?\n/).forEach(line => { const i = line.indexOf(":"); if (i > 0) fm[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); });
    }
    const h = body.match(/^#\s+(.+)$/m);
    const paras = body.replace(/^#.*$/gm, "").split(/\r?\n\s*\r?\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const title = fm.title || (h && h[1].trim()) || niceName(path);
    const summary = fm.summary || (paras[0] || "").slice(0, 320);
    return { type: inferType(path, fm.type), title, tags: splitTags(fm.tags), summary, body, url: fm.url || fm.link || "", file: path, sample: false };
  }
  function normalize(x, path) {
    if (!x || typeof x !== "object") return null;
    const title = x.title || x.name || niceName(path);
    const body = String(x.body || x.text || x.content || "");
    return { type: inferType(path, x.type), title: String(title), tags: splitTags(x.tags || x.topics), summary: String(x.summary || x.excerpt || body.slice(0, 320)), body, url: String(x.url || x.link || ""), file: path, sample: false };
  }
  /** files: [{path, text}] -> {items, skipped} */
  function parseRepoFiles(files) {
    const items = []; let skipped = 0;
    files.forEach(f => {
      try {
        if (/\.json$/i.test(f.path)) {
          let d = JSON.parse(f.text);
          if (!Array.isArray(d)) d = Array.isArray(d.items) ? d.items : [d];
          d.forEach(x => { const n = normalize(x, f.path); if (n) items.push(n); });
        } else items.push(parseText(f.text, f.path));
      } catch (e) { skipped++; }
    });
    return { items, skipped };
  }
  async function loadFiles(fileList) {
    const all = Array.from(fileList);
    const files = all.filter(f => /\.(md|markdown|txt|json)$/i.test(f.name));
    const read = [];
    for (const f of files) { try { read.push({ path: f.webkitRelativePath || f.name, text: await f.text() }); } catch (e) {} }
    const r = parseRepoFiles(read);
    r.skipped += all.length - read.length;
    return r;
  }

  window.LNC = { DAY, ago, dateOf, sum, listJoin, plural, firstName, companyOf, SAMPLE_REPO, rec, scoreLead, interestProfile, matchContent, signalsFor, RECOMMEND, analyze, shortSummary, askText, itemLink, templateEmail, draftFacts, parseRepoFiles, loadFiles };
})();
