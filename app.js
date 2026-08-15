/* app.js — views and routing. Hash-based router so the app works as a
 * plain static file with no server: #/ #/client/ENG-001 #/intake
 * #/reference #/dashboard #/settings
 */
const App = (() => {
  const root = document.getElementById("app");

  const INTAKE_ISSUES = [
    "Mis-Communication", "Project In-efficiency", "Lack of team Management",
    "Lack of role Clarity", "Workflow Issue",
  ];

  function boot() {
    fetch("process-def.json").then((r) => r.json()).then((def) => {
      Engine.boot(def);
      window.addEventListener("hashchange", render);
      Sync.onStateChange(renderSyncPill);
      render();
      if (Sync.isConfigured()) {
        Sync.pullAll()
          .then((r) => { if (r.pulled) { toast(`Synced ${r.pulled} client(s) from GitHub`); render(); } })
          .then(() => Sync.flushQueue())   // push anything local that never reached GitHub
          .then(() => renderSyncPill())
          .catch((e) => toast("Sync on load failed: " + e.message));
      }

      // Cross-device freshness: returning to this tab re-pulls from GitHub,
      // so a client added on the phone appears on the desktop without anyone
      // needing to know that "reload = refresh". Throttled to once per 20s.
      let lastFocusPull = 0;
      const focusPull = () => {
        if (!Sync.isConfigured() || document.hidden) return;
        const rn = route().name;
        // NEVER while a form is open -- a background render was wiping
        // half-filled intake forms when Rahul switched desktops. Forms are
        // sacred; sync waits.
        if (rn === "intake" || rn === "import") return;
        const now = Date.now();
        if (now - lastFocusPull < 20000) return;
        lastFocusPull = now;
        Sync.pullAll()
          .then((r) => { if (r.pulled || r.removed) render(); })
          .then(() => Sync.flushQueue())
          .catch(() => {}); // pill + Settings already surface errors
      };
      window.addEventListener("focus", focusPull);
      document.addEventListener("visibilitychange", focusPull);
    }).catch((e) => {
      root.innerHTML = `<div class="empty">Could not load process-def.json.<br>${esc(e.message)}</div>`;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function route() {
    let h = location.hash.replace(/^#\/?/, "");
    let query = {};
    const qi = h.indexOf("?");
    if (qi !== -1) {
      new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { query[k] = v; });
      h = h.slice(0, qi);
    }
    const parts = h.split("/").filter(Boolean);
    return { name: parts[0] || "home", arg: parts[1], query };
  }

  function nav(path) { location.hash = path; }

  // ---------------- render shell ----------------
  // Re-rendering the SAME view (ticking a task, a background pull finding
  // changes) keeps the scroll position -- the screen must never jump out
  // from under a tap. Navigating to a DIFFERENT view starts at the top.
  let _lastViewKey = null;
  function render() {
    const r = route();
    const viewKey = r.name + "/" + (r.arg || "");
    const sameView = viewKey === _lastViewKey;
    _lastViewKey = viewKey;
    const y = window.scrollY;
    document.querySelectorAll("nav a").forEach((a) => a.classList.remove("active"));
    const activeLink = document.querySelector(`nav a[data-route="${r.name}"]`);
    if (activeLink) activeLink.classList.add("active");
    renderSyncPill();
    document.body.classList.toggle("client-mode", r.name === "intake" && r.query.mode === "client");

    if (r.name === "home") viewHome();
    else if (r.name === "client") viewClient(r.arg);
    else if (r.name === "intake") viewIntake(r.query.mode === "client");
    else if (r.name === "import") viewImport();
    else if (r.name === "doc") viewDoc(r.arg, r.query.client);
    else if (r.name === "docs") viewDocsIndex();
    else if (r.name === "reference") viewReference();
    else if (r.name === "dashboard") viewDashboard();
    else if (r.name === "settings") viewSettings();
    else viewHome();

    window.scrollTo(0, sameView ? y : 0);
  }

  function renderSyncPill() {
    const el = document.getElementById("syncPill");
    if (!el) return; // called before first render in rare boot-order cases
    const state = Sync.isConfigured() ? Sync.getState() : "local";
    const labels = {
      local: "Local only", synced: "Synced", pending: "Sync pending",
      offline: "Offline", error: "Sync error",
    };
    el.textContent = labels[state] || "Local only";
    el.className = "sync-pill " + state;
  }

  // ---------------- HOME: clients board ----------------
  function viewHome() {
    const clients = Store.all();
    const used = Store.pilotsUsed();
    let html = `<div class="view">
      <div class="spread">
        <h2 class="vtitle">Clients</h2>
        <span><button class="btn" onclick="App.nav('import')">Import intake code</button>
        <button class="btn primary" onclick="App.nav('intake')">+ Add client</button></span>
      </div>
      <div class="card sm" style="display:flex;justify-content:space-between;align-items:center">
        <span><b>${used} / 5</b> pilot slots used <span class="mut">&middot; ₹45,000 each, expires at slot 5</span></span>
      </div>`;

    const calendlyHome = localStorage.getItem("od_calendly_url") || "";
    html += `<div class="row" style="flex-wrap:wrap;margin-bottom:4px">
      <a class="btn small" href="https://mail.google.com/mail/?view=cm&fs=1" target="_blank" rel="noopener">&#9993; New email</a>
      <a class="btn small" href="https://calendar.google.com/calendar/render?action=TEMPLATE" target="_blank" rel="noopener">&#128197; New calendar event</a>
      ${calendlyHome ? `<a class="btn small" href="${esc(calendlyHome)}" target="_blank" rel="noopener">&#128337; Calendly</a>` : ""}
      <a class="btn small" href="#/docs">&#128196; All documents</a>
    </div>`;
    html += legendHTML();
    if (clients.length === 0) {
      html += `<div class="empty">No clients yet. Two ways to begin:<br>
        <b>+ Add client</b> above for a new organisation &mdash; or, if your records
        live on GitHub already, configure <b>Settings &rarr; GitHub sync</b> and
        they will pull in automatically.</div>`;
    } else {
      clients.forEach((c) => { html += clientCard(c); });
    }
    html += `</div>`;
    root.innerHTML = html;
  }

  function clientCard(c) {
    const prog = Engine.progress(c);
    const dots = prog.dots.map((d) => `<i class="${d.state === "done" ? "done" : d.state === "doing" ? "doing" : d.state === "blocked" ? "blocked" : ""}"></i>`).join("");
    const step = Engine.stepByN(c.currentStep);
    return `<div class="card client-card" onclick="App.nav('client/${c.id}')">
      <div class="spread">
        <div>
          <b>${esc(c.org)}</b>
          <div class="sm mut">${esc(c.contact || "")}${c.acct ? " &middot; " + esc(c.acct) : ""}</div>
        </div>
        <span class="pill ${c.status}">${esc(c.status)}</span>
      </div>
      <div class="progress">${dots}</div>
      <div class="xs mut">${prog.done} of ${prog.total} steps done${c.pilotSlot ? ` &middot; Pilot slot ${c.pilotSlot} of 5` : ""}
        ${step ? ` &middot; now at Step ${step.n} &middot; ${esc(step.title)}` : ""}</div>
    </div>`;
  }

  // ---------------- CLIENT DETAIL ----------------
  function viewClient(id) {
    const c = Store.get(id);
    if (!c) { root.innerHTML = `<div class="empty">Client not found.</div>`; return; }
    const step = Engine.currentStep(c);
    const complete = Engine.isStepComplete(c, step);
    const canAdv = Engine.canAdvance(c, step);
    const isLast = Engine.indexOfN(step.n) === Engine.flat().length - 1;
    const alreadyDone = c.stepState && c.stepState[step.n] && c.stepState[step.n].state === "done";
    const finished = isLast && alreadyDone;

    let html = `<div class="view">
      <div class="spread">
        <div>
          <span class="pill ${c.status}">${esc(c.status)}</span>
          <h2 class="vtitle" style="margin-top:6px">${esc(c.org)}</h2>
          <div class="sm mut">${esc(c.contact || "")}${c.acct ? " &middot; " + esc(c.acct) : ""}</div>
        </div>
        <button class="btn small" onclick="App.nav('home')">&larr; Clients</button>
      </div>
      ${c.note ? `<div class="rulebox">${esc(c.note)}</div>` : ""}

      <div class="section-label">${finished ? "Process complete" : "Current step"}</div>
      <div class="step ${step.gate ? "gate-step" : ""} open">
        <div class="step-head">
          <div class="sn">${step.n}</div>
          <div class="t"><h4>${esc(step.title)}</h4><div class="tag">${esc(step.tag)}</div></div>
          ${step.gate ? '<span class="pill gate">Clarity gate</span>' : ""}
        </div>
        <div class="step-body" style="display:block">
          ${taskGroupsHTML(c, step)}
          ${(step.rules || []).map((r) => `<div class="rulebox"><b>${esc(r.t)}</b><br>${esc(r.d)}</div>`).join("")}
          ${step.gate ? clarityGateHTML(c, step) : ""}
          <div class="row" style="margin-top:14px">
            ${finished
              ? '<div class="rulebox"><b>&#10003; This client has completed every step in the process.</b> Nothing further to advance.</div>'
              : `<button class="btn primary" ${canAdv ? "" : "disabled"} onclick="App.doAdvance('${c.id}')">
                  ${isLast ? "Complete process" : "Advance to next step"}
                </button>
                ${!complete ? '<span class="xs mut">Tick every task above to unlock</span>' : ""}
                ${complete && step.gate && !canAdv ? '<span class="xs mut">Confirm the Clarity gate above to unlock</span>' : ""}`}
          </div>
        </div>
      </div>

      ${smartLinksHTML(c)}

      ${playbookHTML(c)}

      ${intakeHTML(c)}

      ${documentsHTML(step, c)}

      <div class="section-label">Waiting on client</div>
      ${waitListHTML(c, "waitingOnClient")}
      <div class="row"><input id="addWaitClient" placeholder="Add something you're waiting on the client for" style="flex:1">
        <button class="btn small" onclick="App.addWait('${c.id}','waitingOnClient')">Add</button></div>

      <div class="section-label">Waiting on us</div>
      ${waitListHTML(c, "waitingOnUs")}
      <div class="row"><input id="addWaitUs" placeholder="Add something we owe" style="flex:1">
        <button class="btn small" onclick="App.addWait('${c.id}','waitingOnUs')">Add</button></div>

      <div class="section-label">Full step map for this client</div>
      ${legendHTML()}
      <div class="steplist">${Engine.flat().map((s) => stepRowHTML(c, s)).join("")}</div>

      <div class="section-label">Log</div>
      <ul class="loglist">${(c.log || []).slice().reverse().map((l) => `<li><b>${esc(l.date)}</b> &mdash; ${esc(l.event)}</li>`).join("")}</ul>

      <div class="row" style="margin-top:20px">
        <button class="btn danger small" onclick="App.confirmDelete('${c.id}')">Delete this client</button>
      </div>
    </div>`;
    root.innerHTML = html;
  }

  function taskGroupsHTML(c, step) {
    const items = Engine.taskItems(step);
    const byGroup = {};
    items.forEach((t) => { (byGroup[t.group] = byGroup[t.group] || []).push(t); });
    let html = "";
    ["have", "send", "get"].forEach((g) => {
      const list = byGroup[g];
      if (!list || !list.length) return;
      html += `<div class="taskgroup"><h5>${esc(list[0].groupLabel)}</h5>`;
      list.forEach((t) => {
        if (!t.checkable) {
          html += `<div class="task"><span class="xs mut">&middot;</span><label>${esc(t.text)}</label></div>`;
          return;
        }
        const done = c.tasks && c.tasks[t.key] && c.tasks[t.key].done;
        const flag = t.cls === "miss" ? '<span class="flag miss">gap</span>'
          : t.cls === "warn" ? '<span class="flag part">check</span>' : "";
        html += `<div class="task ${done ? "done" : ""}">
          <input type="checkbox" id="t_${t.key.replace(/[^a-zA-Z0-9]/g, "_")}" ${done ? "checked" : ""}
            onchange="App.toggleTask('${c.id}','${t.key}',this.checked)">
          <label for="t_${t.key.replace(/[^a-zA-Z0-9]/g, "_")}">${esc(t.text)}</label>${flag}
        </div>`;
      });
      html += `</div>`;
    });
    return html || '<div class="mut sm">No tasks recorded for this step.</div>';
  }

  function clarityGateHTML(c, step) {
    const confirmed = c.clarityConfirmed && c.clarityConfirmed[step.n];
    return `<div class="gatebox">
      <b>&#9873; CLARITY gate.</b> This step does not advance until you confirm the engagement's
      specific problem has actually been routed through Clarity and a verdict recorded &mdash;
      not just skipped because a deadline is close.
      <div style="margin-top:8px">
        <label style="display:inline-flex;align-items:center;gap:8px;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px">
          <input type="checkbox" ${confirmed ? "checked" : ""} onchange="App.toggleGate('${c.id}','${step.n}',this.checked)">
          Clarity has routed this engagement's problem and a verdict is recorded
        </label>
      </div>
    </div>`;
  }

  function documentsHTML(step, client) {
    const docs = (window.DOCS && window.DOCS.byStep && window.DOCS.byStep[step.n]) || [];
    if (!docs.length) return "";
    let html = `<div class="section-label">Documents &amp; package for this step</div><div class="card">`;
    docs.forEach((d) => {
      const badge = d.status === "exists" ? ["exists","have it"] : d.tpl ? ["exists","draft in app"] : ["placeholder","gap"];
      const openLink = d.tpl
        ? `<a href="#/doc/${d.tpl}${client ? "?client=" + client.id : ""}" class="xs" style="margin-left:auto">open</a>`
        : d.url ? `<a href="${esc(d.url)}" class="xs" style="margin-left:auto" target="_blank" rel="noopener">open</a>` : "";
      html += `<div class="docrow">
        <span class="st ${badge[0]}">${badge[1]}</span>
        <span>${esc(d.name)}</span>
        ${openLink}
      </div>`;
      const sub = [d.location ? "Where: " + d.location : null, d.note || null].filter(Boolean).join(" · ");
      if (sub) html += `<div class="xs mut" style="padding-left:64px;margin-top:-3px;margin-bottom:6px">${esc(sub)}</div>`;
    });
    html += `</div>`;
    return html;
  }

  function intakeHTML(c) {
    const i = c.intake;
    if (!i) return "";
    const rows = [
      ["What issue do they say they want to solve?", i.issue],
      ["What do they think they need?", i.ask],
      ["What is not working now?", i.q1],
      ["Who is affected?", i.q2],
      ["Since when?", i.q3],
      ["What evidence shows the issue?", i.q4],
      ["What has already been tried and stopped?", i.q5],
      ["What would improvement look like in daily work?", i.q6],
      ["Who must approve change?", i.q7],
      ["Existing communication model", i.comms],
      ["Active members in the org", i.members],
      ["Baseline", (i.baseline || []).join(" · ")],
      ["Notes", i.notes],
    ].filter(([, v]) => v && String(v).trim());
    if (!rows.length) return "";
    return `<div class="section-label">Intake answers</div><div class="card">
      ${rows.map(([label, val]) => `<div style="margin-bottom:9px"><div class="xs mut" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">${esc(label)}</div><div class="sm">${esc(val)}</div></div>`).join("")}
    </div>`;
  }

  function waitListHTML(c, field) {
    const list = c[field] || [];
    if (!list.length) return '<div class="mut sm" style="margin-bottom:8px">&mdash; none &mdash;</div>';
    return `<ul class="waitlist">${list.map((w, i) => `<li>
      <button onclick="App.removeWait('${c.id}','${field}',${i})" title="Remove">&times;</button>
      <span>${esc(w)}</span></li>`).join("")}</ul>`;
  }

  function stepRowHTML(c, s) {
    const st = (c.stepState && c.stepState[s.n] && c.stepState[s.n].state) || "pending";
    const note = c.stepState && c.stepState[s.n] && c.stepState[s.n].note;
    const isCurrent = c.currentStep === s.n;
    return `<div class="step ${s.gate ? "gate-step" : ""} ${isCurrent ? "current" : ""}">
      <div class="step-head" onclick="this.parentElement.classList.toggle('open')">
        <span class="sdot ${st}"></span>
        <div class="sn">${s.n}</div>
        <div class="t"><h4>${esc(s.title)}</h4><div class="tag">${esc(s.tag)}</div></div>
        <span class="pill ${st}">${st}</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="step-body">
        ${note ? `<div class="rulebox">${esc(note)}</div>` : ""}
        ${taskGroupsHTML(c, s)}
        ${(s.rules || []).map((r) => `<div class="rulebox"><b>${esc(r.t)}</b><br>${esc(r.d)}</div>`).join("")}
        ${(s.qa && s.qa.length) ? `<div class="qa">${s.qa.map((x) => `<details><summary>${esc(x.q)}</summary><div class="ans">${esc(x.a)}</div></details>`).join("")}</div>` : ""}
        ${documentsHTML(s)}
      </div>
    </div>`;
  }

  // ---------------- INTAKE FORM ----------------
  function viewIntake(clientMode) {
    root.innerHTML = `<div class="view" oninput="App.saveDraft()">
      <h2 class="vtitle">${clientMode ? "Organisation intake form" : "Add a client &mdash; intake"}</h2>
      <p class="sm mut">${clientMode
        ? "Please answer what you can &mdash; skip anything unclear, everything can be discussed later. When you submit, you'll get a short code to send back on WhatsApp or email. <b>Nothing is uploaded anywhere</b>; the code is the data, and only the person you send it to can read it."
        : "Fills the 7 discovery questions, your own ClickUp pre-planning fields, and the baseline -- the three numbers that later prove the change happened. Saving creates the client at Step 0."}</p>

      <fieldset><legend>Who</legend>
        <div class="formgrid">
          <div><label>Organisation *</label><input id="f_org" required></div>
          <div><label>Contact name</label><input id="f_contact"></div>
          <div><label>Contact title</label><input id="f_title"></div>
          ${clientMode ? "" : `<div><label>Account / source code <span class="opt">(auto-filled, editable)</span></label><input id="f_acct" value="${esc(nextAcct())}"></div>`}
        </div>
      </fieldset>

      <fieldset><legend>Their issue vs. their ask &mdash; keep these separate</legend>
        <label>What issue do they say they want to solve? <span class="opt">(their words)</span></label>
        <select id="f_issue"><option value="">&mdash; choose &mdash;</option>
          ${INTAKE_ISSUES.map((i) => `<option>${esc(i)}</option>`).join("")}
          <option>Other</option></select>
        <label>What do they think they need? <span class="opt">(their shopping list)</span></label>
        <textarea id="f_ask" rows="2"></textarea>
      </fieldset>

      <fieldset><legend>The 7 discovery questions (1.3)</legend>
        <label>What is not working now?</label><textarea id="f_q1" rows="2"></textarea>
        <label>Who is affected?</label><textarea id="f_q2" rows="2"></textarea>
        <label>Since when has this been happening?</label><input id="f_q3">
        <label>What evidence shows the issue?</label><textarea id="f_q4" rows="2"></textarea>
        <label>What has already been tried and stopped? <span class="opt">(the graveyard question)</span></label>
        <textarea id="f_q5" rows="2"></textarea>
        <label>What would improvement look like in daily work?</label><textarea id="f_q6" rows="2"></textarea>
        <label>Who must approve change?</label><input id="f_q7">
      </fieldset>

      <fieldset><legend>Context</legend>
        <div class="formgrid">
          <div><label>How does information move in the org today? <span class="opt">(their channels, not a theory)</span></label>
            <input id="f_comms" placeholder="e.g. WhatsApp group + monthly meeting + paper registers"></div>
          <div><label>Active members in the org</label><input id="f_members"></div>
        </div>
      </fieldset>

      ${clientMode ? "" : `<fieldset><legend>Baseline &mdash; 3 numbers measured TODAY, so change can be proven later</legend>
        <p class="xs mut" style="margin:2px 0 8px">Measure the problem before touching it. Six months later, measure the same three again &mdash; that before/after is the case study. Without this, results stay opinions.</p>
        <div class="formgrid">
          <div><label>Number 1</label><input id="f_b1" placeholder="e.g. days from field visit to report reaching office: 11"></div>
          <div><label>Number 2</label><input id="f_b2" placeholder="e.g. hands each report passes through: 4"></div>
          <div><label>Number 3</label><input id="f_b3" placeholder="e.g. reports funder returned with queries last quarter: 6 of 10"></div>
        </div>
      </fieldset>`}

      <fieldset><legend>Notes</legend>
        <textarea id="f_notes" rows="3"></textarea>
      </fieldset>

      <div class="form-actions">
        ${clientMode
          ? `<button class="btn primary" onclick="App.makeIntakeCode()">Get my code to send back</button>`
          : `<button class="btn" onclick="App.shareIntakeLink()">Share client-fillable link</button>
             <button class="btn" onclick="App.nav('home')">Cancel</button>
             <button class="btn primary" onclick="App.saveIntake()">Save client</button>`}
      </div>
      <div id="codeout"></div>
    </div>`;
    restoreDraft();
  }

  // Draft autosave: every keystroke in the intake form persists to
  // localStorage; reopening the form restores it. Cleared only on save.
  // With this, NOTHING can wipe a half-filled form -- not a render, not a
  // reload, not switching desktops, not closing the tab.
  const DRAFT_KEY = "od_intake_draft_v1";
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(readIntake())); } catch (e) {}
  }
  function restoreDraft() {
    let d;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return; }
    if (!d) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set("f_org", d.org); set("f_contact", d.contact); set("f_title", d.title); set("f_acct", d.acct);
    set("f_issue", d.issue); set("f_ask", d.ask);
    set("f_q1", d.q1); set("f_q2", d.q2); set("f_q3", d.q3); set("f_q4", d.q4);
    set("f_q5", d.q5); set("f_q6", d.q6); set("f_q7", d.q7);
    set("f_comms", d.comms); set("f_members", d.members);
    if (d.baseline) { set("f_b1", d.baseline[0]); set("f_b2", d.baseline[1]); set("f_b3", d.baseline[2]); }
    set("f_notes", d.notes);
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  // Auto-suggests the next AKL-nnn source code from the highest one in use.
  function nextAcct() {
    let max = 0;
    Store.all().forEach((c) => {
      const m = /^AKL-(\d+)$/.exec(c.acct || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "AKL-" + String(max + 1).padStart(3, "0");
  }

  // The colour key, in plain words -- shown wherever the coloured dots are.
  function legendHTML() {
    return `<div class="colorkey">
      <span><i class="ck" style="background:var(--ok)"></i>Green = step done</span>
      <span><i class="ck" style="background:var(--part)"></i>Orange = in progress now</span>
      <span><i class="ck" style="background:var(--block)"></i>Red = blocked, needs something</span>
      <span><i class="ck" style="background:var(--line)"></i>Grey = not started yet</span>
    </div>`;
  }

  // The tailored path: the issue named at intake selects this client's
  // playbook -- what to diagnose first, likely root causes, matched
  // interventions, the documents that matter most, and what to measure.
  function playbookHTML(c) {
    const issues = (window.PB && window.PB.issues) || {};
    const issue = c.intake && c.intake.issue;
    if (!issue || !issues[issue]) {
      const opts = Object.keys(issues).map((k) => `<option ${k === issue ? "selected" : ""}>${esc(k)}</option>`).join("");
      return `<div class="section-label">Tailored path</div><div class="card">
        <p class="sm mut">No issue recorded for this client yet. Choose the issue they named, and their tailored playbook appears here:</p>
        <select onchange="App.setIssue('${c.id}', this.value)"><option value="">&mdash; choose the issue &mdash;</option>${opts}</select>
      </div>`;
    }
    const pb = issues[issue];
    return `<div class="section-label">Tailored path &mdash; ${esc(issue)}</div>
      <div class="card">
        <p class="sm"><b>${esc(pb.summary)}</b></p>
        <div class="section-label" style="margin-top:10px">Diagnose first</div>
        <ul class="plain">${pb.diagnoseFirst.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="section-label">Likely root causes</div>
        <ul class="plain">${pb.rootCauses.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="section-label">Matched interventions</div>
        ${pb.interventions.map((iv) => `<div style="margin-bottom:7px"><b class="sm">${esc(iv.n)}</b><div class="sm mut">${esc(iv.d)}</div></div>`).join("")}
        <div class="section-label">Baseline these numbers</div>
        <ul class="plain">${pb.indicators.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="section-label">Documents that matter most here</div>
        <div class="row" style="flex-wrap:wrap">${pb.keyDocs.map((id) => {
          const t = window.TPL && window.TPL.templates && window.TPL.templates[id];
          return t ? `<a class="btn small" href="#/doc/${id}?client=${c.id}">${esc(t.title.split(" — ")[0].split(" (")[0])}</a>` : "";
        }).join("")}</div>
        <div class="rulebox" style="margin-top:10px"><b>Watch for:</b> ${esc(pb.watchFor)}</div>
      </div>`;
  }

  function setIssue(clientId, issue) {
    const c = Store.get(clientId);
    if (!c) return;
    c.intake = c.intake || {};
    c.intake.issue = issue;
    c.log = c.log || [];
    c.log.push({ date: Engine.todayISO(), event: `Issue set: ${issue} -- tailored playbook activated` });
    Store.save(c);
    render();
  }

  function readIntake() {
    const v = (id) => (document.getElementById(id) || {}).value || "";
    return {
      org: v("f_org"), contact: v("f_contact"), title: v("f_title"), acct: v("f_acct"),
      issue: v("f_issue"), ask: v("f_ask"),
      q1: v("f_q1"), q2: v("f_q2"), q3: v("f_q3"), q4: v("f_q4"), q5: v("f_q5"), q6: v("f_q6"), q7: v("f_q7"),
      comms: v("f_comms"), members: v("f_members"),
      baseline: [v("f_b1"), v("f_b2"), v("f_b3")].filter(Boolean),
      notes: v("f_notes"),
    };
  }

  function saveIntake() {
    const intake = readIntake();
    if (!intake.org.trim()) { toast("Organisation name is required"); return; }
    const id = Store.nextId();
    const client = {
      id, org: intake.org, contact: intake.contact, acct: intake.acct || null,
      status: "active", note: "", pilotSlot: nextPilotSlot(),
      currentStep: "0",
      stepState: { "0": { state: "doing", date: Engine.todayISO() } },
      tasks: {}, clarityConfirmed: {},
      intake, waitingOnClient: [], waitingOnUs: [],
      log: [{ date: Engine.todayISO(), event: "Client added via intake form" }],
    };
    Store.save(client);
    clearDraft();
    toast("Client added");
    nav("client/" + id);
  }

  function nextPilotSlot() {
    const used = Store.pilotsUsed();
    return used < 5 ? used + 1 : null;
  }

  function shareIntakeLink() {
    const url = location.origin + location.pathname + "#/intake?mode=client";
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    toast("Link copied -- send it to the client on WhatsApp or email. They fill the form and send you back a code; import it from the Clients page.");
  }

  // ---- intake codes: UTF-8 safe base64url. The code IS the data -- nothing
  // is uploaded anywhere; a client without a token has no write path, so the
  // data travels back through whatever channel they already use (WhatsApp).
  function encodeIntake(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return "ODI1." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeIntake(code) {
    code = code.trim();
    if (!code.startsWith("ODI1.")) throw new Error("Not an intake code (should start with ODI1.)");
    let b64 = code.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function makeIntakeCode() {
    const intake = readIntake();
    if (!intake.org.trim()) { toast("Organisation name is required"); return; }
    const code = encodeIntake(intake);
    const out = document.getElementById("codeout");
    out.innerHTML = `<div class="card" style="margin-top:14px">
      <b>Done. Send this whole code back:</b>
      <textarea readonly rows="5" style="margin-top:8px;font-family:monospace;font-size:12px" onclick="this.select()">${esc(code)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" onclick="navigator.clipboard.writeText(this.parentElement.previousElementSibling.value).then(()=>App.toast('Copied'))">Copy code</button>
        <span class="xs mut">Paste it into WhatsApp or email, send, done.</span>
      </div>
    </div>`;
    out.scrollIntoView({ behavior: "smooth" });
  }

  // In-app document viewer: shows a template with the client's details
  // filled in, ready to copy or download. The document lives IN the app.
  function viewDoc(id, clientId) {
    const t = window.TPL && window.TPL.templates && window.TPL.templates[id];
    if (!t) { root.innerHTML = `<div class="empty">Document not found.</div>`; return; }
    const c = clientId ? Store.get(clientId) : null;
    let body = t.body
      .replace(/{{ORG}}/g, c ? c.org : "[ORGANISATION]")
      .replace(/{{CONTACT}}/g, c && c.contact ? c.contact : "[CONTACT NAME]")
      .replace(/{{DATE}}/g, new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }));
    root.innerHTML = `<div class="view">
      <div class="spread">
        <div><h2 class="vtitle">${esc(t.title)}</h2>
          ${c ? `<div class="sm mut">Prepared for ${esc(c.org)}</div>` : ""}</div>
        <button class="btn small" onclick="history.back()">&larr; Back</button>
      </div>
      ${t.status === "draft" ? `<div class="rulebox"><b>DRAFT.</b> Written by the system, not yet reviewed by you. Read it fully and edit before it ever reaches a client. Once you approve it, tell the next session to mark it final.</div>` : ""}
      <div class="card"><pre class="docbody" id="docbody">${esc(body)}</pre></div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" onclick="navigator.clipboard.writeText(document.getElementById('docbody').textContent).then(()=>App.toast('Copied -- paste into Gmail, Word, anywhere'))">Copy full text</button>
        <button class="btn" onclick="App.downloadDoc('${esc(id)}')">Download (.txt)</button>
      </div>
    </div>`;
  }

  function downloadDoc(id) {
    const el = document.getElementById("docbody");
    if (!el) return;
    const blob = new Blob([el.textContent], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = id + "-" + Engine.todayISO() + ".txt";
    a.click();
  }

  // Smart links: one-tap actions that need no login and no API --
  // stable URL contracts only (the integration decision of 15 Aug).
  function smartLinksHTML(c) {
    const subj = encodeURIComponent("Regarding our OD engagement -- " + c.org);
    const body = encodeURIComponent("Dear " + (c.contact || "") + ",\n\n");
    const gmail = "https://mail.google.com/mail/?view=cm&fs=1&su=" + subj + "&body=" + body;
    const gcalText = encodeURIComponent("Follow up: " + c.org + " (OD)");
    const gcal = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + gcalText;
    const calendly = localStorage.getItem("od_calendly_url") || "";
    return `<div class="section-label">Quick actions</div>
      <div class="row" style="flex-wrap:wrap">
        <a class="btn small" href="${gmail}" target="_blank" rel="noopener">&#9993; Draft email in Gmail</a>
        <a class="btn small" href="${gcal}" target="_blank" rel="noopener">&#128197; Add follow-up to Calendar</a>
        ${calendly ? `<a class="btn small" href="${esc(calendly)}" target="_blank" rel="noopener">&#128337; Open Calendly</a>`
                   : `<a class="btn small" href="#/settings">&#128337; Set Calendly link&hellip;</a>`}
      </div>`;
  }

  // Every document in one place, with review status -- the review desk.
  function viewDocsIndex() {
    const T = (window.TPL && window.TPL.templates) || {};
    const order = ["entry-criteria","touch1-email","touch3-value","readiness-check","holding-reply",
      "call-structure","process-note","proposal","tor","engagement-brief","doc-checklist",
      "confidentiality-note","interview-guide","capacity-assessment","diagnostic-report",
      "feedback-plan","action-plan","handover-pack","case-study-request","lesson-log"];
    const ids = order.filter((id) => T[id]).concat(Object.keys(T).filter((id) => !order.includes(id)));
    let html = `<div class="view"><h2 class="vtitle">Documents</h2>
      <p class="sm mut">Every document the practice uses, in engagement order. <b>Draft</b> = written,
      awaiting your review -- read it, ask for edits, or approve it. <b>Final</b> = approved by you.</p>
      <div class="card">`;
    ids.forEach((id) => {
      const t = T[id];
      html += `<div class="docrow">
        <span class="st ${t.status === "final" ? "exists" : "placeholder"}">${t.status === "final" ? "final" : "draft"}</span>
        <span>${esc(t.title)}</span>
        <span class="xs mut" style="margin-left:auto;white-space:nowrap">Step ${esc(t.step)}</span>
        <a href="#/doc/${id}" class="xs" style="margin-left:10px">open</a>
      </div>`;
    });
    html += `</div></div>`;
    root.innerHTML = html;
  }

  function viewImport() {
    root.innerHTML = `<div class="view">
      <h2 class="vtitle">Import a client's intake code</h2>
      <p class="sm mut">Paste the ODI1. code the client sent back. It becomes a new client record,
        with every answer they gave in place.</p>
      <textarea id="importcode" rows="6" style="font-family:monospace;font-size:12px" placeholder="ODI1...."></textarea>
      <div class="form-actions">
        <button class="btn" onclick="App.nav('home')">Cancel</button>
        <button class="btn primary" onclick="App.doImportCode()">Import</button>
      </div>
    </div>`;
  }

  function doImportCode() {
    const raw = (document.getElementById("importcode") || {}).value || "";
    let intake;
    try { intake = decodeIntake(raw); }
    catch (e) { toast("Could not read that code: " + e.message); return; }
    if (!intake.org || !intake.org.trim()) { toast("Code has no organisation name"); return; }
    const id = Store.nextId();
    const c = {
      id, org: intake.org, contact: intake.contact || "", acct: intake.acct || null,
      status: "active", pilotSlot: null, currentStep: "0",
      stepState: { "0": { state: "doing", date: Engine.todayISO() } },
      tasks: {}, clarityConfirmed: {},
      intake, waitingOnClient: [], waitingOnUs: [],
      log: [{ date: Engine.todayISO(), event: "Client created from an intake code they filled themselves" }],
    };
    Store.save(c);
    toast("Imported " + intake.org);
    nav("client/" + id);
  }

  // ---------------- REFERENCE (the old static map, now a view) ----------------
  function viewReference() {
    const d = Engine.def();
    let html = `<div class="view"><h2 class="vtitle">Process reference</h2>
      <p class="sm mut">${esc(d.subtitle)}</p>`;
    d.stages.forEach((st) => {
      html += `<div class="ref-stage"><h3>Stage ${st.id} &middot; ${esc(st.title)}</h3>
        <p class="sm mut">${esc(st.intro)}</p>`;
      st.steps.forEach((s) => {
        html += `<details class="refstep"><summary><span class="pill ${s.status === "gate" ? "gate" : s.status === "ok" ? "done" : s.status === "part" ? "doing" : "blocked"}">${s.n}</span> ${esc(s.title)} <span class="xs mut">&mdash; ${esc(s.tag)}</span></summary>
          <div class="body">
            <div class="cols3">
              <div><h5>Have in hand</h5><ul>${(s.have || []).map((h) => `<li>${esc(h[1])}</li>`).join("")}</ul></div>
              <div><h5>Send / share</h5><ul>${(s.send || []).map((h) => `<li>${esc(h[1])}</li>`).join("")}</ul></div>
              <div><h5>Get back out</h5><ul>${(s.get || []).map((h) => `<li>${esc(h[1])}</li>`).join("")}</ul></div>
            </div>
            ${(s.rules || []).map((r) => `<div class="rulebox"><b>${esc(r.t)}</b><br>${esc(r.d)}</div>`).join("")}
            ${(s.qa && s.qa.length) ? `<div class="qa">${s.qa.map((x) => `<details><summary>${esc(x.q)}</summary><div class="ans">${esc(x.a)}</div></details>`).join("")}</div>` : ""}
            ${documentsHTML(s)}
          </div></details>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    root.innerHTML = html;
  }

  // ---------------- DASHBOARD ----------------
  // The open-the-app-in-the-morning view: everything currently owed,
  // aggregated across active clients, each line linking to its client.
  function needsAttentionHTML(clients) {
    const act = clients.filter((c) => c.status === "active");
    const owedByUs = [];
    const stuckOnClient = [];
    act.forEach((c) => {
      (c.waitingOnUs || []).forEach((w) => owedByUs.push({ c, w }));
      (c.waitingOnClient || []).forEach((w) => stuckOnClient.push({ c, w }));
    });
    if (!owedByUs.length && !stuckOnClient.length) return "";
    const row = (x) => `<div class="docrow" style="cursor:pointer" onclick="App.nav('client/${x.c.id}')">
      <span>${esc(x.w)}</span>
      <span class="xs mut" style="margin-left:auto;white-space:nowrap">${esc(x.c.org)}</span>
    </div>`;
    let html = `<div class="section-label">Needs attention</div>`;
    if (owedByUs.length) {
      html += `<div class="card"><b class="sm">We owe (${owedByUs.length})</b>${owedByUs.map(row).join("")}</div>`;
    }
    if (stuckOnClient.length) {
      html += `<div class="card"><b class="sm">Waiting on clients (${stuckOnClient.length})</b>${stuckOnClient.map(row).join("")}</div>`;
    }
    return html;
  }

  function viewDashboard() {
    const clients = Store.all();
    const used = Store.pilotsUsed();
    const flat = Engine.flat();
    const totalTasks = flat.reduce((a, s) => a + Engine.taskItems(s).filter((t) => t.checkable).length, 0);
    const active = clients.filter((c) => c.status === "active").length;
    let html = `<div class="view"><h2 class="vtitle">Dashboard</h2>
      <div class="statgrid">
        <div class="stat"><b>${used} / 5</b><small>Pilot slots used</small></div>
        <div class="stat"><b>${active}</b><small>Active engagements</small></div>
        <div class="stat"><b>${clients.length}</b><small>Total clients tracked</small></div>
        <div class="stat"><b>${flat.length}</b><small>Steps in the process</small></div>
      </div>
      ${needsAttentionHTML(clients)}
      <div class="section-label">Package build-status, by stage</div>`;
    Engine.def().stages.forEach((st) => {
      const items = st.steps.reduce((a, s) => a.concat(s.have || []), []);
      const ok = items.filter((i) => i[0] === "ok").length;
      const part = items.filter((i) => i[0] === "part").length;
      const miss = items.filter((i) => i[0] === "miss").length;
      const total = items.length || 1;
      html += `<div class="card">
        <div class="spread"><b>${esc(st.title)}</b><span class="xs mut">${st.steps.length} steps</span></div>
        <div class="meter">
          ${Array(ok).fill('<i class="ok"></i>').join("")}
          ${Array(part).fill('<i class="part"></i>').join("")}
          ${Array(miss).fill('<i class="miss"></i>').join("")}
        </div>
        <div class="xs mut">${Math.round((ok / total) * 100)}% of tracked items built</div>
      </div>`;
    });
    html += `</div>`;
    root.innerHTML = html;
  }

  // ---------------- SETTINGS ----------------
  function viewSettings() {
    const cfg = Sync.getConfig() || { owner: "", repo: "rkv-od-data", token: "" };
    const configured = Sync.isConfigured();
    root.innerHTML = `<div class="view"><h2 class="vtitle">Settings</h2>

      <div class="card">
        <div class="spread"><b>GitHub sync</b><span class="pill ${configured ? "active" : "pending"}">${configured ? "configured" : "not set up"}</span></div>
        <p class="sm mut">Client data is stored in a private GitHub repo you own. The token below is
          saved only in this browser &mdash; it is never sent anywhere except api.github.com, never
          written to any file. Paste it fresh on every device you use.</p>

        <label>GitHub username / organisation</label>
        <input id="s_owner" placeholder="e.g. rahulkvimal" value="${esc(cfg.owner)}">
        <label>Data repo name</label>
        <input id="s_repo" value="${esc(cfg.repo || "rkv-od-data")}">
        <label>Fine-grained personal access token <span class="opt">(Contents: Read and write, on this repo only)</span></label>
        <input id="s_token" type="password" placeholder="github_pat_..." value="${esc(cfg.token)}">

        <div class="row" style="margin-top:14px">
          <button class="btn" onclick="App.testConnection()">Test connection</button>
          <button class="btn primary" onclick="App.saveSync()">Save</button>
          ${configured ? '<button class="btn danger" onclick="App.disconnectSync()">Disconnect</button>' : ""}
        </div>
        <div id="s_result" class="sm" style="margin-top:10px"></div>

        ${configured ? `
        <div class="row" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
          <button class="btn" onclick="App.syncNow()">Sync now</button>
          <span class="sm mut">${Sync.getQueue().length ? Sync.getQueue().length + " client(s) waiting to push" : "Nothing queued"}</span>
        </div>
        ${Sync.getLastError() ? `<div class="sm" style="margin-top:8px;color:var(--miss)"><b>Last sync error:</b> ${esc(Sync.getLastError())}</div>` : ""}` : ""}
      </div>

      <div class="card">
        <b>Quick actions</b>
        <p class="sm mut">Your Calendly link, used by the "Open Calendly" button on every client.</p>
        <input id="s_calendly" placeholder="https://calendly.com/your-link" value="${esc(localStorage.getItem("od_calendly_url") || "")}">
        <div class="row" style="margin-top:8px"><button class="btn" onclick="localStorage.setItem('od_calendly_url',(document.getElementById('s_calendly').value||'').trim());App.toast('Saved')">Save link</button></div>
      </div>

      <div class="card">
        <b>Backup</b>
        <p class="sm mut">A local export, independent of GitHub sync. Worth doing before any big change.</p>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="App.exportBackup()">Export all clients (.json)</button>
          <label class="btn" style="margin:0">Import backup<input type="file" accept=".json" style="display:none" onchange="App.importBackup(this)"></label>
        </div>
      </div>
    </div>`;
  }

  function readSyncForm() {
    return {
      owner: (document.getElementById("s_owner").value || "").trim(),
      repo: (document.getElementById("s_repo").value || "").trim(),
      token: (document.getElementById("s_token").value || "").trim(),
    };
  }

  function testConnection() {
    const cfg = readSyncForm();
    const out = document.getElementById("s_result");
    out.textContent = "Testing…";
    if (!cfg.owner || !cfg.repo || !cfg.token) { out.textContent = "Fill in all three fields first."; return; }
    Sync.testConnection(cfg).then((r) => {
      out.textContent = r.message;
      out.style.color = r.ok ? "var(--ok)" : "var(--miss)";
    });
  }

  function saveSync() {
    const cfg = readSyncForm();
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast("Fill in all three fields first"); return; }
    Sync.setConfig(cfg);
    toast("Saved. Syncing now…");
    Sync.pullAll().then((r) => {
      toast(`Connected. Pulled ${r.pulled} client(s).`);
      return Sync.flushQueue();          // push anything local that never reached GitHub
    }).then(() => {
      const err = Sync.getLastError();
      if (err) toast("Push problem: " + err);
      render();
    }).catch((e) => toast("Saved, but the first sync failed: " + e.message));
    render();
  }

  function disconnectSync() {
    if (!confirm("Disconnect GitHub sync? Your data stays in this browser either way -- this only stops pushing/pulling.")) return;
    Sync.clearConfig();
    render();
  }

  function syncNow() {
    toast("Syncing…");
    Sync.flushQueue().then(() => Sync.pullAll()).then((r) => {
      const err = Sync.getLastError();
      if (err) toast("Sync finished with a problem: " + err);
      else toast(`Synced. Pulled ${r.pulled} client(s).`);
      render();
    }).catch((e) => toast("Sync failed: " + e.message));
  }

  function exportBackup() {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "od-dashboard-backup-" + Engine.todayISO() + ".json";
    a.click();
  }

  function importBackup(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = Store.importJSON(reader.result);
        toast(`Imported ${n} client(s)`);
        nav("home");
      } catch (e) {
        toast("Import failed: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------------- actions called from inline handlers ----------------
  function toggleTask(clientId, key, checked) {
    const c = Store.get(clientId);
    c.tasks = c.tasks || {};
    c.tasks[key] = { done: checked, date: Engine.todayISO() };
    Store.save(c);
    render();
  }

  function toggleGate(clientId, stepN, checked) {
    const c = Store.get(clientId);
    c.clarityConfirmed = c.clarityConfirmed || {};
    c.clarityConfirmed[stepN] = checked;
    if (checked) {
      c.log = c.log || [];
      c.log.push({ date: Engine.todayISO(), event: `Clarity gate confirmed at step ${stepN}` });
    }
    Store.save(c);
    render();
  }

  function doAdvance(clientId) {
    const c = Store.get(clientId);
    Engine.advance(c);
    Store.save(c);
    toast("Advanced");
    render();
  }

  function addWait(clientId, field) {
    const inputId = field === "waitingOnClient" ? "addWaitClient" : "addWaitUs";
    const input = document.getElementById(inputId);
    const val = (input.value || "").trim();
    if (!val) return;
    const c = Store.get(clientId);
    c[field] = c[field] || [];
    c[field].push(val);
    Store.save(c);
    render();
  }

  function removeWait(clientId, field, idx) {
    const c = Store.get(clientId);
    c[field].splice(idx, 1);
    Store.save(c);
    render();
  }

  function confirmDelete(clientId) {
    const c = Store.get(clientId);
    if (!c) return;
    if (confirm(`Delete ${c.org}? This removes it here AND from GitHub (every device). The record stays recoverable in the data repo's git history.`)) {
      Sync.deleteClient(clientId).then((r) => {
        if (r.remote) toast("Deleted everywhere");
        else if (r.queued) toast("Deleted here; GitHub delete queued" + (r.error ? " (" + r.error + ")" : ""));
        else toast("Deleted (local only -- sync not configured)");
        nav("home");
      });
    }
  }

  return {
    boot, nav, render, toast,
    saveIntake, shareIntakeLink, makeIntakeCode, doImportCode, exportBackup, importBackup,
    saveDraft, downloadDoc, setIssue,
    toggleTask, toggleGate, doAdvance, addWait, removeWait, confirmDelete,
    testConnection, saveSync, disconnectSync, syncNow,
  };
})();
