/* sync.js — GitHub Contents API layer. Reads/writes client records to a
 * private data repo so they survive forever and are visible on every
 * device, not just the one they were typed on.
 *
 * The token lives ONLY in this browser's localStorage. It is never written
 * to any file, never committed, never sent anywhere except api.github.com
 * with this browser's own requests. Losing/clearing browser storage means
 * re-pasting the token, not losing data -- the data repo is the source of
 * truth once synced.
 *
 * Design: local-first. Store.js (localStorage) is always the fast path and
 * always works offline. This module is a one-way-feeling but actually
 * two-way reconciliation layer on top of it: pull merges remote into local
 * on boot/refresh, push sends local changes out, queued while offline and
 * flushed on reconnect. Conflict rule (per the approved plan): last write
 * wins per client file -- on a 409 (stale sha) we re-fetch the current sha
 * and retry once, overwriting remote with local. Git history in the data
 * repo is the safety net if that's ever wrong; nothing is destroyed, only
 * superseded, and every version is recoverable from the repo's commit log.
 */
const Sync = (() => {
  const CFG_KEY = "od_sync_cfg_v1";
  const QUEUE_KEY = "od_sync_queue_v1";
  const API = "https://api.github.com";

  let stateListeners = [];
  let currentState = "local"; // local | synced | pending | offline | error
  let lastError = null;   // the real GitHub error message, shown in Settings -- failures must be visible, not hidden behind the pill

  function onStateChange(fn) { stateListeners.push(fn); }
  function setState(s) {
    currentState = s;
    stateListeners.forEach((fn) => fn(s));
  }
  function getState() { return currentState; }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    } catch (e) { return null; }
  }

  function setConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(CFG_KEY);
    setState("local");
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c && c.token && c.owner && c.repo);
  }

  // ---------------- queue (offline durability) ----------------
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  function enqueue(clientId) {
    const q = getQueue();
    if (!q.includes(clientId)) { q.push(clientId); setQueue(q); }
    setState(navigator.onLine ? "pending" : "offline");
  }
  function dequeue(clientId) {
    setQueue(getQueue().filter((id) => id !== clientId));
  }

  // ---------------- UTF-8 safe base64 (org names may contain Hindi etc.) --
  function b64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64Decode(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------------- raw Contents API calls ----------------
  function headers(cfg) {
    return {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // Returns {content, sha} or null if the file doesn't exist (404, which is
  // a normal case here -- e.g. the very first client ever synced).
  async function getFile(path) {
    const cfg = getConfig();
    if (!cfg) throw new Error("Not configured");
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      headers: headers(cfg),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await safeMsg(res)}`);
    const json = await res.json();
    return { content: b64Decode(json.content), sha: json.sha };
  }

  // Creates or updates a file. Pass the previous sha to update; omit to
  // create. On a 409 (someone/something else changed the file since we last
  // read it) we re-fetch and retry once with the fresh sha -- last write
  // wins, per the approved plan, and every prior version stays in git
  // history on the data repo regardless.
  async function putFile(path, content, sha, message) {
    const cfg = getConfig();
    if (!cfg) throw new Error("Not configured");
    const body = { message, content: b64Encode(content) };
    if (sha) body.sha = sha;
    let res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      method: "PUT", headers: headers(cfg), body: JSON.stringify(body),
    });
    if (res.status === 409 || res.status === 422) {
      const fresh = await getFile(path);
      body.sha = fresh ? fresh.sha : undefined;
      res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
        method: "PUT", headers: headers(cfg), body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${await safeMsg(res)}`);
    return res.json();
  }

  async function safeMsg(res) {
    try { return (await res.json()).message || res.statusText; }
    catch (e) { return res.statusText; }
  }

  // ---------------- connection test ----------------
  // Verifies the token actually works and can reach the configured repo,
  // without assuming -- reports the real failure (bad token, wrong repo
  // name, repo not private/found, no Contents permission) rather than a
  // generic "failed".
  async function testConnection(cfg) {
    try {
      const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(cfg) });
      if (res.status === 401) return { ok: false, message: "Token rejected -- check it was copied in full." };
      if (res.status === 404) return { ok: false, message: `Repo "${cfg.owner}/${cfg.repo}" not found, or this token can't see it -- check the fine-grained token's repository access includes it.` };
      if (!res.ok) return { ok: false, message: `GitHub said: ${await safeMsg(res)}` };
      const repo = await res.json();
      const perms = repo.permissions || {};
      if (!perms.push) return { ok: false, message: "Token can read this repo but not write to it -- check the token's Contents permission is set to Read and write." };
      return { ok: true, message: `Connected to ${cfg.owner}/${cfg.repo} (${repo.private ? "private" : "PUBLIC -- this should be private"}).` };
    } catch (e) {
      return { ok: false, message: "Network error reaching GitHub: " + e.message };
    }
  }

  // ---------------- high-level sync operations ----------------
  // Pull: reconcile remote into local. Any client that exists remotely and
  // not locally (or differs) is merged in -- EXCEPT clients with a pending
  // local push queued, which are left alone so an unsent local edit is
  // never silently overwritten by an older remote copy.
  async function pullAll() {
    if (!isConfigured()) return { pulled: 0 };
    setState("pending");
    const idx = await getFile("index.json");
    if (!idx) { setState("synced"); return { pulled: 0 }; }
    const ids = JSON.parse(idx.content).ids || [];
    const queue = getQueue();
    let pulled = 0;
    for (const id of ids) {
      if (queue.includes(id)) continue; // don't clobber an unsent local edit
      const f = await getFile(`clients/${id}.json`);
      if (f) {
        const remote = JSON.parse(f.content);
        remote._sha = f.sha;
        Store.saveLocalOnly(remote);
        pulled++;
      }
    }
    setState(getQueue().length ? "pending" : "synced");
    return { pulled };
  }

  // Push one client's current local state out. Updates index.json only
  // when the id is genuinely new to it (avoids a redundant write on every
  // save of an existing client).
  async function pushClient(client) {
    if (!isConfigured()) return;
    if (!navigator.onLine) { enqueue(client.id); return; }
    setState("pending");
    try {
      const path = `clients/${client.id}.json`;
      const existing = await getFile(path);
      const body = Object.assign({}, client);
      delete body._sha;
      const result = await putFile(path, JSON.stringify(body, null, 2), existing ? existing.sha : undefined,
        `Update ${client.org} (${client.id})`);
      client._sha = result.content.sha;
      Store.saveLocalOnly(client);

      const idxFile = await getFile("index.json");
      const ids = idxFile ? JSON.parse(idxFile.content).ids : [];
      if (!ids.includes(client.id)) {
        ids.push(client.id);
        await putFile("index.json", JSON.stringify({ ids }, null, 2), idxFile ? idxFile.sha : undefined,
          `Add ${client.id} to index`);
      }
      dequeue(client.id);
      lastError = null;
      setState(getQueue().length ? "pending" : "synced");
    } catch (e) {
      console.error("Push failed", e);
      lastError = `${client.org} (${client.id}): ${e.message}`;
      enqueue(client.id);
      setState("error");
      throw e;
    }
  }

  // Flush every queued client, in order, stopping cleanly (not throwing) on
  // the first failure so the rest stay queued for the next attempt rather
  // than being abandoned.
  async function flushQueue() {
    if (!isConfigured() || !navigator.onLine) return;
    // Reconciliation, not just queue-draining. The bug this fixes, found
    // live on 15 Aug: a client created BEFORE sync was configured was never
    // pushed and never queued (correct at the time -- the app was
    // local-only), and nothing ever went back for it once a token was
    // saved. It sat stranded in localStorage while the pill said "Synced".
    // So: every local client that has never reached GitHub (no _sha from a
    // successful push) gets queued here, every time. Makes "Sync now" and
    // the post-configure flush genuinely mean "everything local is remote".
    Store.all().forEach((c) => { if (!c._sha) enqueue(c.id); });
    const queue = getQueue();
    for (const id of queue) {
      const client = Store.get(id);
      if (!client) { dequeue(id); continue; }
      try { await pushClient(client); }
      catch (e) { break; }
    }
    setState(getQueue().length ? "error" : "synced");
  }

  window.addEventListener("online", () => { setState(getQueue().length ? "pending" : "synced"); flushQueue(); });
  window.addEventListener("offline", () => { setState("offline"); });

  return {
    getConfig, setConfig, clearConfig, isConfigured,
    getState, onStateChange, getQueue,
    getLastError: () => lastError,
    testConnection, pullAll, pushClient, flushQueue, enqueue,
  };
})();
