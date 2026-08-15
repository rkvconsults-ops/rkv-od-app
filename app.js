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
        const now = Date.now();
        if (now - lastFocusPull < 20000) return;
        lastFocusPull = now;
        Sync.pullAll()
          .then((r) => { if (r.pulled) render(); })
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
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean);
    return { name: parts[0] || "home", arg: parts[1] };
  }

  function nav(path) { location.hash = path; }

  // ---------------- render shell ----------------
  function render() {
    const r = route();
    document.querySelectorAll("nav a").forEach((a) => a.classList.remove("active"));
    const activeLink = document.querySelector(`nav a[data-route="${r.name}"]`);
    if (activeLink) activeLink.classList.add("active");
    renderSyncPill();

    if (r.name === "home") return viewHome();
    if (r.name === "client") return viewClient(r.arg);
    if (r.name === "intake") return viewIntake();
    if (r.name === "reference") return viewReference();
    if (r.name === "dashboard") return viewDashboard();
    if (r.name === "settings") return viewSettings();
    return viewHome();
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
        <button class="btn primary" onclick="App.nav('intake')">+ Add client</button>
      </div>
      <div class="card sm" style="display:flex;justify-content:space-between;align-items:center">
        <span><b>${used} / 5</b> pilot slots used <span class="mut">&middot; ₹45,000 each, expires at slot 5</span></span>
      </div>`;

    if (clients.length === 0) {
      html += `<div class="empty">No clients yet. Add one to get started.</div>`;
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

      ${intakeHTML(c)}

      ${documentsHTML(step)}

      <div class="section-label">Waiting on client</div>
      ${waitListHTML(c, "waitingOnClient")}
      <div class="row"><input id="addWaitClient" placeholder="Add something you're waiting on the client for" style="flex:1">
        <button class="btn small" onclick="App.addWait('${c.id}','waitingOnClient')">Add</button></div>

      <div class="section-label">Waiting on us</div>
      ${waitListHTML(c, "waitingOnUs")}
      <div class="row"><input id="addWaitUs" placeholder="Add something we owe" style="flex:1">
        <button class="btn small" onclick="App.addWait('${c.id}','waitingOnUs')">Add</button></div>

      <div class="section-label">Full step map for this client</div>
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

  function documentsHTML(step) {
    const docs = (window.DOCS && window.DOCS.byStep && window.DOCS.byStep[step.n]) || [];
    if (!docs.length) return "";
    let html = `<div class="section-label">Documents for this step</div><div class="card">`;
    docs.forEach((d) => {
      html += `<div class="docrow">
        <span class="st ${d.status}">${d.status === "exists" ? "have it" : "gap"}</span>
        <span>${esc(d.name)}</span>
        ${d.path ? `<a href="${esc(d.path)}" class="xs" style="margin-left:auto" target="_blank">open</a>` : ""}
      </div>${d.note ? `<div class="xs mut" style="padding-left:64px;margin-top:-3px;margin-bottom:4px">${esc(d.note)}</div>` : ""}`;
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
      </div>
    </div>`;
  }

  // ---------------- INTAKE FORM ----------------
  function viewIntake() {
    root.innerHTML = `<div class="view">
      <h2 class="vtitle">Add a client &mdash; intake</h2>
      <p class="sm mut">Fills the 7 discovery questions (methodology §1.3), your own ClickUp
        pre-planning fields, and the baseline Clarity flagged as the highest-value habit to start.
        Saving creates the client at Step 0.</p>

      <fieldset><legend>Who</legend>
        <div class="formgrid">
          <div><label>Organisation *</label><input id="f_org" required></div>
          <div><label>Contact name</label><input id="f_contact"></div>
          <div><label>Contact title</label><input id="f_title"></div>
          <div><label>Account / source code</label><input id="f_acct" placeholder="e.g. AKL-002"></div>
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

      <fieldset><legend>The 7 discovery questions (§1.3)</legend>
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
          <div><label>Existing communication model</label><input id="f_comms"></div>
          <div><label>Active members in the org</label><input id="f_members"></div>
        </div>
      </fieldset>

      <fieldset><legend>Baseline &mdash; 3 countable things, before anything changes</legend>
        <div class="formgrid">
          <div><label>Metric 1</label><input id="f_b1" placeholder="e.g. days from field visit to report"></div>
          <div><label>Metric 2</label><input id="f_b2"></div>
          <div><label>Metric 3</label><input id="f_b3"></div>
        </div>
      </fieldset>

      <fieldset><legend>Notes</legend>
        <textarea id="f_notes" rows="3"></textarea>
      </fieldset>

      <div class="form-actions">
        <button class="btn" onclick="App.shareIntakeLink()">Share client-fillable link</button>
        <button class="btn" onclick="App.nav('home')">Cancel</button>
        <button class="btn primary" onclick="App.saveIntake()">Save client</button>
      </div>
    </div>`;
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
    toast("Client added");
    nav("client/" + id);
  }

  function nextPilotSlot() {
    const used = Store.pilotsUsed();
    return used < 5 ? used + 1 : null;
  }

  function shareIntakeLink() {
    const url = location.origin + location.pathname + "#/intake?mode=client";
    navigator.clipboard && navigator.clipboard.writeText(url);
    toast("Link copied. Client-facing intake + import-by-code lands in M4.");
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
          </div></details>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    root.innerHTML = html;
  }

  // ---------------- DASHBOARD ----------------
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
    if (confirm(`Delete ${c.org}? This cannot be undone in this browser (export a backup first if unsure).`)) {
      Store.remove(clientId);
      toast("Deleted");
      nav("home");
    }
  }

  return {
    boot, nav, render, toast,
    saveIntake, shareIntakeLink, exportBackup, importBackup,
    toggleTask, toggleGate, doAdvance, addWait, removeWait, confirmDelete,
    testConnection, saveSync, disconnectSync, syncNow,
  };
})();
