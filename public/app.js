/* Lead Nurture Copilot UI. Same layout and behaviour as the artifact v3, with data from the server:
   POST /api/connect, GET /api/leads, GET /api/lead?email=, POST /api/draft, GET /api/content.
   At /demo the same UI runs on the five fictional leads in your browser (public/demo-data.js): no sign-in and
   no ActiveCampaign. Only Claude drafts and the content/ folder come from the server's public /demo/api/ routes. */
(function () {
  "use strict";
  const L = window.LNC;
  const LOCAL = /^\/demo\/?$/.test(location.pathname);
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clockOf = iso => new Date(iso || Date.now()).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  async function remote(path, opts) {
    const r = await fetch(path, Object.assign({ headers: { "content-type": "application/json" }, credentials: "same-origin" }, opts || {}));
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(j.error || ("HTTP " + r.status)); err.status = r.status; err.log = j.log || []; throw err; }
    return j;
  }
  const api = (path, opts) => LOCAL ? localApi(path, opts) : remote(path, opts);

  /* Browser-only demo: answers the same API calls from public/demo-data.js. */
  let demoSrc = null;
  const demoSource = () => demoSrc || (demoSrc = window.LNC_DEMO.create({
    site: (state.status && state.status.siteDomain) || "akdaisolutions.com",
    connectNote: "fictional leads, running in your browser",
    payloadNote: "Demo data: fictional leads generated in your browser. No ActiveCampaign connection."
  }));
  async function localApi(path, opts) {
    const u = new URL(path, location.origin);
    switch (u.pathname) {
      case "/api/status": {
        let s = {};
        try { s = await remote("/demo/api/status"); } catch (e) {}
        return { mode: "demo", local: true, siteDomain: s.siteDomain || "akdaisolutions.com", windowDays: 30, maxLeads: 25, opensSource: "demo",
          llm: s.llm || { available: false }, sender: s.sender || { name: "Amar Kumar Dani", company: "AKD AI Solutions", booking: "" }, auth: false };
      }
      case "/api/connect": return demoSource().connect();
      case "/api/leads": return demoSource().listLeads();
      case "/api/lead": {
        const email = String(u.searchParams.get("email") || "").trim().toLowerCase();
        const r = demoSource().getLead(email);
        if (r.notFound) { const err = new Error("No demo lead with " + email + ". Use Retrieve all leads to see the five demo leads."); err.status = 404; err.log = r.log; throw err; }
        return r;
      }
      case "/api/content": return remote("/demo/api/content");
      case "/api/draft": return remote("/demo/api/draft", opts);
    }
    throw new Error("Not available in the demo.");
  }

  const state = {
    status: null, connected: false, connecting: false, busy: false, fetchingAll: false, allLoaded: false,
    leads: [], repo: L.SAMPLE_REPO.slice(), repoLocal: false, repoServer: false, repoLabel: "sample content",
    lead: null, analysis: null,
    actions: store.get("lnc.actions", {}),
    sender: store.get("lnc.sender", null)
  };
  const SITE = () => (state.status && state.status.siteDomain) || "your site";
  const isDemo = () => state.status && state.status.mode === "demo";

  /* ---------- Log ---------- */
  function addLog(mark, msg, result, t) {
    const li = document.createElement("li");
    li.innerHTML = '<span>' + clockOf(t) + '</span><span class="' + (mark === "✓" ? "ok" : mark === "✗" ? "bad" : "") + '">' + esc(mark) + '</span><span class="m">' + esc(msg) + (result ? ' <span class="r">→ ' + esc(result) + '</span>' : "") + '</span>';
    $("log").appendChild(li);
    $("m-log").textContent = $("log").children.length + " entries";
  }
  const addServerLog = entries => (entries || []).forEach(e => addLog(e.mark, e.msg, e.result, e.t));

  /* ---------- Picker ---------- */
  function renderPicker() {
    const p = $("picker");
    if (!state.connected) {
      p.innerHTML = '<div class="cta"><div><p class="q">Connect ActiveCampaign</p><p class="why">Pull each lead’s website visits and email activity, match your case studies and posts, and get a nurture email ready to send.</p><p class="note warn" id="conn-note"></p></div>' +
        (state.connecting ? '<p class="step"><span class="spin" aria-hidden="true"></span><span id="conn-step">Connecting…</span></p>' : '<button class="btn primary" type="button" id="ac-go">Connect ActiveCampaign</button>') + '</div>';
      if (!state.connecting) $("ac-go").onclick = () => connectAC();
      return;
    }
    p.innerHTML = '<div class="get"><button class="btn" type="button" id="get-all">' + (state.allLoaded ? "Refresh all leads" : "Retrieve all leads") + '</button><span class="or">or</span>' +
      '<form class="lookup" id="lookup" novalidate><input type="email" id="lookup-email" placeholder="Enter a lead’s email" aria-label="Lead email" autocomplete="off"><button class="btn primary" type="submit">Retrieve</button></form></div>' +
      '<p class="note" id="lookup-note"></p><div id="leads-wrap"></div>';
    $("get-all").onclick = () => retrieveAll(state.allLoaded);
    $("lookup").addEventListener("submit", e => {
      e.preventDefault();
      const v = $("lookup-email").value.trim().toLowerCase();
      if (!v || v.indexOf("@") < 1) { lookupNote("Enter a valid email address.", "warn"); return; }
      lookupNote(""); retrieveOne(v);
    });
    renderLeads();
  }
  function lookupNote(msg, cls) { const n = $("lookup-note"); if (!n) return; n.textContent = msg; n.className = "note " + (cls || ""); }

  async function retrieveAll(refresh) {
    if (state.busy || state.fetchingAll) return;
    state.fetchingAll = true;
    const b = $("get-all"); b.disabled = true;
    b.innerHTML = '<span class="spin" aria-hidden="true"></span> Retrieving leads and activity…';
    lookupNote(isDemo() ? "" : "Reading each lead’s visits and email activity. This can take a little while for many leads.", "");
    try {
      const r = await api("/api/leads" + (refresh ? "?refresh=1" : ""));
      addServerLog(r.log);
      state.leads = r.leads || []; state.allLoaded = true;
      lookupNote(state.leads.length ? "" : "No contacts returned. Check AC_LEAD_TAG_ID / AC_LEAD_LIST_ID.", state.leads.length ? "" : "warn");
    } catch (e) {
      addServerLog(e.log); addLog("✗", "Retrieving leads", e.message);
      lookupNote(e.message, "warn");
    }
    state.fetchingAll = false;
    b.disabled = false; b.textContent = state.allLoaded ? "Refresh all leads" : "Retrieve all leads";
    renderLeads();
  }
  function renderLeads() {
    const w = $("leads-wrap"); if (!w) return;
    if (!state.allLoaded) { w.innerHTML = ""; return; }
    const rows = state.leads.map(l => ({ l, sc: L.scoreLead(l) })).sort((a, b) => b.sc.s - a.sc.s);
    w.innerHTML = '<p class="list-h">' + rows.length + ' leads · most engaged first</p><ul class="lead-rows">' + rows.map(r => {
      const act = state.actions[r.l.email];
      const co = r.l.company || r.l.domain || "";
      return '<li><button type="button" class="lead-row" data-email="' + esc(r.l.email) + '" aria-pressed="' + (!!state.lead && state.lead.email === r.l.email) + '">' +
        '<span class="g ' + r.sc.grade + '" aria-hidden="true"></span><span class="ln">' + esc(r.l.name) + (co ? ' <span class="tsub" style="display:inline">· ' + esc(co) + '</span>' : "") + '</span>' +
        '<span class="lg ' + r.sc.grade + '">' + r.sc.grade + ' ' + r.sc.s + (act ? '<small>' + esc(act.split(" at ")[0]) + '</small>' : "") + '</span>' +
        '<span class="le">' + esc(r.l.email) + '</span></button></li>';
    }).join("") + '</ul>';
    w.querySelectorAll(".lead-row").forEach(b => b.onclick = () => {
      const l = state.leads.find(x => x.email === b.dataset.email);
      if (l) { lookupNote(""); showLead(l, null, [{ t: new Date().toISOString(), mark: "·", msg: "Lead: " + l.email, result: "from the retrieved list" }]); }
    });
  }

  /* ---------- Connection ---------- */
  async function connectAC() {
    if (state.connecting || state.connected) return;
    state.connecting = true; renderPicker();
    $("ac-line").textContent = "Connecting to ActiveCampaign…";
    try {
      const r = await api("/api/connect", { method: "POST", body: "{}" });
      addServerLog(r.log);
      state.connecting = false; state.connected = true;
      $("ac-line").innerHTML = '<span class="okdot" aria-hidden="true"></span>' + (r.mode === "demo" ? "Demo data" : "ActiveCampaign connected");
      $("ac-detail").textContent = r.mode === "demo" ? (LOCAL ? "Demo data · runs in your browser, no ActiveCampaign connection needed" : "Demo data · set AC_API_URL and AC_API_KEY on the server to connect") :"Connected · " + r.account + (r.user ? " · " + r.user : "") + " · site tracking on " + r.siteDomain;
      $("ac-connect").hidden = false;
      renderPicker(); renderSources();
      const inp = $("lookup-email"); if (inp) inp.focus();
    } catch (e) {
      addServerLog(e.log);
      state.connecting = false; renderPicker();
      $("ac-line").textContent = "ActiveCampaign not connected";
      const n = $("conn-note"); if (n) n.textContent = e.message;
    }
  }
  function disconnectAC() {
    if (state.busy) return;
    state.connected = false; state.allLoaded = false; state.leads = []; state.lead = null; state.analysis = null;
    $("lead").innerHTML = ""; $("ac-line").textContent = "ActiveCampaign not connected";
    $("ac-detail").textContent = "Not connected"; $("ac-connect").hidden = true;
    ["web", "mail", "content"].forEach(id => $(id).innerHTML = ""); ["m-activity", "m-content"].forEach(id => $(id).textContent = "");
    $("payload").textContent = "{}";
    addLog("·", "Disconnected");
    renderPicker(); renderSources();
  }

  /* ---------- Lead ---------- */
  function showProgress(text, pct) {
    let bar = $("bar");
    if (!bar) {
      $("lead").innerHTML = '<div class="progress"><div class="bar"><i id="bar"></i></div><p class="step"><span class="spin" aria-hidden="true"></span><span id="step-text"></span></p></div>';
      bar = $("bar");
    }
    $("step-text").textContent = text;
    requestAnimationFrame(() => { bar.style.width = pct + "%"; });
  }
  async function retrieveOne(email) {
    if (state.busy || !state.connected) return;
    state.busy = true; state.lead = null; state.analysis = null;
    renderLeads();
    $("lead").innerHTML = "";
    showProgress("Reading contact, site visits and email activity for " + email + "…", 30);
    setTimeout(() => { if ($("bar")) $("bar").style.width = "80%"; }, 400);
    try {
      const r = await api("/api/lead?email=" + encodeURIComponent(email));
      state.busy = false;
      showLead(r.lead, r.payload, r.log);
    } catch (e) {
      state.busy = false;
      addServerLog(e.log);
      $("lead").innerHTML = "";
      lookupNote(e.message, "warn");
    }
  }
  function showLead(lead, payload, log) {
    addServerLog(log);
    const i = state.leads.findIndex(x => x.email === lead.email);
    if (i >= 0) state.leads[i] = lead;
    state.lead = lead;
    const a = L.analyze(lead, state.repo); state.analysis = a;
    addLog("✓", "Matched case studies and posts", state.repo.length + " items scanned");
    addLog("✓", "Scored engagement", a.sc.s + "/100 " + a.sc.grade);
    if ($("lookup-email")) $("lookup-email").value = lead.email;
    renderActivity(lead); renderContent(a); renderLead(lead, a); renderLeads();
    $("payload").textContent = JSON.stringify(payload || { lead }, null, 2);
  }
  function renderLead(lead, a) {
    const ask = L.askText(lead, a), act = state.actions[lead.email];
    const sub = [lead.title, lead.company || (lead.domain ? lead.domain : ""), lead.location].filter(Boolean).join(" · ");
    $("lead").innerHTML =
      '<div class="lead-top"><div><h2>' + esc(lead.name) + '</h2><p class="sub">' + esc(sub || lead.email) + '</p></div>' +
      '<div class="score ' + a.sc.grade + '" aria-label="Engagement ' + a.sc.s + ' of 100, ' + a.sc.grade + '"><b>' + a.sc.s + '</b><span>' + a.sc.grade + '</span></div></div>' +
      '<p class="summary">' + esc(L.shortSummary(lead, a)) + '</p>' +
      '<ul class="sig">' + a.sig.slice(0, 3).map(s => '<li class="' + s.lvl + '">' + esc(s.text) + '</li>').join("") + '</ul>' +
      '<div class="ask"><p class="q">' + esc(ask.q) + '</p><p class="why">' + esc(ask.why) + '</p>' +
      (act ? '<p class="done-note">' + esc(act) + '</p>' : "") +
      '<div class="row" id="ask-actions"><button class="btn primary" type="button" id="a-draft">Draft email</button><button class="btn" type="button" id="a-snooze">Snooze 3 days</button><button class="btn text" type="button" id="a-skip">Skip</button></div>' +
      '<p class="note" id="ask-note"></p><div id="draft"></div></div>';
    $("a-draft").onclick = () => draftEmail();
    $("a-snooze").onclick = () => markAction("Snoozed 3 days");
    $("a-skip").onclick = () => markAction("Skipped");
  }
  function markAction(label) {
    if (!state.lead) return;
    state.actions[state.lead.email] = label; store.set("lnc.actions", state.actions);
    const n = $("ask-note"); n.textContent = label + "."; n.className = "note ok";
    addLog("·", "Action: " + label);
    renderLeads();
  }
  function renderActivity(lead) {
    const visits = (lead.visits || []).slice().sort((a, b) => (a.daysAgo ?? 999) - (b.daysAgo ?? 999) || b.count - a.count);
    const hasTime = visits.some(v => v.secs);
    $("web").innerHTML = visits.length ? '<table><thead><tr><th>Page</th><th class="num">Views</th>' + (hasTime ? '<th class="num">Avg time</th>' : "") + '<th class="num">Last</th></tr></thead><tbody>' +
      visits.map(v => '<tr><td>' + esc(v.title) + '<span class="tsub">' + esc(v.path) + '</span></td><td class="num">' + v.count + '</td>' +
        (hasTime ? '<td class="num">' + (v.secs ? Math.floor(v.secs / 60) + ':' + String(v.secs % 60).padStart(2, "0") : "—") + '</td>' : "") +
        '<td class="num">' + L.dateOf(v.daysAgo) + '</td></tr>').join("") + '</tbody></table>'
      : '<p class="note">No site-tracking visits on ' + esc(SITE()) + ' in the last ' + ((lead.dataNotes && lead.dataNotes.windowDays) || 30) + ' days.</p>';
    const emails = (lead.emails || []).slice().sort((a, b) => (a.sent ?? 999) - (b.sent ?? 999));
    $("mail").innerHTML = emails.length ? '<table><thead><tr><th>Campaign</th><th class="num">Sent</th><th class="num">Opens</th><th>Clicked</th></tr></thead><tbody>' +
      emails.map(e => '<tr><td>' + esc(e.campaign) + (e.subject ? '<span class="tsub">' + esc(e.subject) + '</span>' : "") + '</td><td class="num">' + L.dateOf(e.sent) + '</td><td class="num">' + (e.opens == null ? "—" : e.opens) + '</td><td>' +
        (e.clicks.length ? e.clicks.map(c => esc(c.label)).join("<br>") : '<span class="tsub">—</span>') + '</td></tr>').join("") + '</tbody></table>' +
        (emails.every(e => e.opens == null) ? '<p class="help">Opens: ' + esc((lead.dataNotes && lead.dataNotes.opens) || "unavailable") + '.</p>' : "")
      : '<p class="note">No campaign emails in the window.</p>';
    const pv = L.sum(lead.visits || [], v => v.count), op = L.sum(emails, e => e.opens), cl = L.sum(emails, e => e.clicks.length);
    $("m-activity").textContent = L.plural(pv, "page view") + " · " + (emails.some(e => e.opens != null) ? L.plural(op, "open") : "opens n/a") + " · " + L.plural(cl, "click");
  }
  function matchHTML(m, label) {
    if (!m) return '<div class="match"><span class="k">' + label + '</span><span class="d">No match in your content.</span></div>';
    const it = m.item;
    return '<div class="match"><span class="k">' + label + (it.sample ? " · sample" : " · " + esc(it.file)) + '</span><span class="t">' + esc(it.title) + '</span>' +
      (it.summary ? '<span class="d">' + esc(it.summary) + '</span>' : "") +
      '<span class="d">Matched on ' + esc(m.hits.slice(0, 3).map(h => h.topic).join(", ")) + '</span>' +
      (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.url) + '</a>' : "") + '</div>';
  }
  function renderContent(a) {
    $("content").innerHTML = matchHTML(a.cs, "Case study") + matchHTML(a.post, "LinkedIn post");
    $("m-content").textContent = a.cs ? a.cs.item.title : "no match";
  }
  function renderSources() {
    const cs = state.repo.filter(i => i.type === "case_study").length, po = state.repo.filter(i => i.type === "linkedin_post").length;
    $("repo-detail").textContent = (state.repoLocal || state.repoServer ? state.repoLabel : "Sample content") + " · " + cs + " case studies, " + po + " posts";
    $("repo-line").textContent = state.repoLocal || state.repoServer ? state.repoLabel : "sample content";
    $("repo-reset").hidden = !state.repoLocal;
    $("demo-line").hidden = !isDemo();
    $("m-sources").textContent = (state.connected ? (isDemo() ? "demo data" : "ActiveCampaign connected") : "ActiveCampaign not connected") + " · " + (state.repoLocal ? "your folder" : state.repoServer ? "server content" : "sample content");
    if (state.status && !isDemo()) {
      $("ac-help").textContent = "Reads contacts, site-tracking visits on " + state.status.siteDomain + ", campaign sends and clicks" + (state.status.opensSource === "v1" ? ", and opens per campaign" : "") + " for the last " + state.status.windowDays + " days.";
    } else if (isDemo()) {
      $("ac-help").textContent = LOCAL
        ? "Demo data: five fictional leads, scored and matched in your browser. Only Claude drafts and your content folder come from the server."
        : "Demo data: the server has no AC_API_URL / AC_API_KEY yet.";
    }
  }

  /* ---------- Draft ---------- */
  function senderNow() {
    const d = (state.status && state.status.sender) || {};
    return { name: $("s-name").value.trim() || d.name || "Amar Kumar Dani", company: $("s-company").value.trim() || d.company || "AKD AI Solutions", booking: $("s-booking").value.trim() || d.booking || "" };
  }
  async function draftEmail() {
    const lead = state.lead, a = state.analysis; if (!lead || !a) return;
    const sender = senderNow();
    $("ask-actions").hidden = true;
    $("draft").innerHTML = '<p class="step"><span class="spin" aria-hidden="true"></span>Writing a draft for ' + esc(L.firstName(lead)) + '…</p>';
    let draft = null, source = "template", note = "";
    if (state.status && state.status.llm && state.status.llm.available) {
      try {
        const r = await api("/api/draft", { method: "POST", body: JSON.stringify({ facts: L.draftFacts(lead, a, sender) }) });
        if (r.ok) { draft = r.draft; source = "claude"; }
        else note = r.code === "rate_limited" ? "Claude is busy right now, so this is the template draft. Try Redraft in a minute."
          : r.code === "invented_link" || r.code === "tracking_language" ? r.message + " Showing the template draft instead; Redraft to try again."
          : "Claude couldn't draft this time, so this is the template draft.";
      } catch (e) { note = "Claude couldn't draft this time, so this is the template draft."; }
    } else note = LOCAL ? "Claude drafting isn't available right now, so this is the template draft." : "No Claude API key on the server, so this is the template draft.";
    if (!draft) draft = L.templateEmail(lead, a, sender);
    addLog("✓", "Draft ready", source === "claude" ? "by Claude" : "template");
    renderDraft(lead, draft, source, note);
  }
  function renderDraft(lead, d, source, note) {
    $("draft").innerHTML = '<div class="draft">' +
      '<p class="to">To ' + esc(lead.name) + ' &lt;' + esc(lead.email) + '&gt; · ' + (source === "claude" ? "drafted by Claude" : "template draft") + '</p>' +
      (note ? '<p class="note warn">' + esc(note) + '</p>' : "") +
      (d.why ? '<p class="note">' + esc(d.why) + '</p>' : "") +
      '<input type="text" id="e-subject" aria-label="Subject">' +
      '<textarea id="e-body" rows="13" aria-label="Email body"></textarea>' +
      '<div class="row"><button class="btn primary" type="button" id="e-send">Approve email</button><button class="btn" type="button" id="e-copy">Copy</button><button class="btn text" type="button" id="e-redraft">Redraft</button><button class="btn text" type="button" id="e-close">Close</button></div>' +
      '<p class="help">Approving records your approval only. Nothing is sent from this app.</p>' +
      '<p class="note" id="e-note"></p></div>';
    $("e-subject").value = d.subject; $("e-body").value = d.body;
    $("e-redraft").onclick = () => draftEmail();
    $("e-close").onclick = () => { $("draft").innerHTML = ""; $("ask-actions").hidden = false; };
    $("e-copy").onclick = async () => {
      try { await navigator.clipboard.writeText("Subject: " + $("e-subject").value + "\n\n" + $("e-body").value); eNote("Copied.", "ok"); }
      catch (e) { $("e-body").select(); eNote("Copy was blocked. The body is selected; press Ctrl+C or ⌘C.", "warn"); }
    };
    $("e-send").onclick = () => {
      const t = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      state.actions[lead.email] = "Email approved at " + t; store.set("lnc.actions", state.actions);
      addLog("✓", "Email approved for " + lead.email);
      eNote("Approved at " + t + ".", "ok");
      renderLeads();
    };
  }
  function eNote(msg, cls) { const n = $("e-note"); n.textContent = msg; n.className = "note " + (cls || ""); }

  /* ---------- Content ---------- */
  async function useFiles(fileList) {
    const n = $("repo-note");
    if (!fileList || !fileList.length) return;
    n.textContent = "Reading files…"; n.className = "note";
    const res = await L.loadFiles(fileList);
    if (!res.items.length) { n.textContent = "No usable .md, .txt or .json files found. Keeping the current content."; n.className = "note warn"; return; }
    const top = (fileList[0].webkitRelativePath || "").split("/")[0];
    state.repo = res.items; state.repoLocal = true; state.repoLabel = top ? top : res.items.length + " local files";
    n.textContent = "Loaded " + res.items.length + " item" + (res.items.length === 1 ? "" : "s") + (res.skipped ? ", skipped " + res.skipped + " other file" + (res.skipped === 1 ? "" : "s") : "") + ".";
    n.className = "note ok";
    renderSources(); rematch();
  }
  function rematch() {
    if (!state.lead || !state.analysis || state.busy) return;
    const a = L.analyze(state.lead, state.repo); state.analysis = a;
    renderContent(a); renderLead(state.lead, a);
    addLog("✓", "Re-matched against " + state.repoLabel, a.cs ? a.cs.item.title : "no match");
  }
  let serverRepo = null;
  async function loadServerContent() {
    try {
      const r = await api("/api/content");
      const res = L.parseRepoFiles(r.files || []);
      if (res.items.length) {
        serverRepo = res.items;
        state.repo = res.items; state.repoServer = true; state.repoLabel = "content folder";
        addLog("✓", "Loaded content folder from server", res.items.length + " items");
      }
    } catch (e) {}
  }

  /* ---------- Wiring ---------- */
  $("ac-connect").onclick = () => disconnectAC();
  $("folder-input").addEventListener("change", e => { useFiles(e.target.files); e.target.value = ""; });
  $("files-input").addEventListener("change", e => { useFiles(e.target.files); e.target.value = ""; });
  $("repo-reset").onclick = () => {
    state.repoLocal = false;
    if (serverRepo) { state.repo = serverRepo.slice(); state.repoServer = true; state.repoLabel = "content folder"; }
    else { state.repo = L.SAMPLE_REPO.slice(); state.repoServer = false; state.repoLabel = "sample content"; }
    $("repo-note").textContent = ""; renderSources(); rematch();
  };
  $("repo-reset").textContent = "Reset";
  const drop = $("drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async e => {
    const dt = e.dataTransfer; if (!dt) return;
    const entries = dt.items ? Array.from(dt.items).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean) : [];
    if (entries.some(en => en.isDirectory)) {
      const files = [];
      const walk = (entry, prefix) => new Promise(res => {
        if (entry.isFile) { entry.file(f => { try { Object.defineProperty(f, "webkitRelativePath", { value: prefix + f.name }); } catch (x) {} files.push(f); res(); }, () => res()); }
        else if (entry.isDirectory) {
          const r = entry.createReader(), all = [];
          const read = () => r.readEntries(async ents => { if (!ents.length) { for (const c of all) await walk(c, prefix + entry.name + "/"); res(); } else { all.push.apply(all, ents); read(); } }, () => res());
          read();
        } else res();
      });
      for (const en of entries) await walk(en, "");
      useFiles(files);
    } else useFiles(dt.files);
  });

  async function init() {
    try { state.status = await api("/api/status"); } catch (e) { state.status = null; }
    if (LOCAL) document.title = "Lead Nurture · demo";
    $("signout").hidden = LOCAL || !(state.status && state.status.auth);
    const def = (state.status && state.status.sender) || { name: "Amar Kumar Dani", company: "AKD AI Solutions", booking: "" };
    if (!state.sender) state.sender = { name: def.name, company: def.company, booking: def.booking };
    ["s-name", "s-company", "s-booking"].forEach((id, i) => {
      const key = ["name", "company", "booking"][i];
      $(id).value = state.sender[key] || "";
      $(id).addEventListener("input", () => { state.sender[key] = $(id).value; store.set("lnc.sender", state.sender); });
    });
    await loadServerContent();
    renderPicker(); renderSources();
  }
  init();
})();
