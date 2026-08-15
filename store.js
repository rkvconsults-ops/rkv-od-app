/* store.js — the database.
 * M1: localStorage only, fully functional offline.
 * M2 will add a sync() call here that pushes/pulls the same shape to the
 * private rkv-od-data repo via the GitHub Contents API. Nothing else in the
 * app needs to change when that lands -- every read/write already goes
 * through this module.
 */
const Store = (() => {
  const KEY = "od_clients_v1";
  const META_KEY = "od_meta_v1";

  function _read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Store read failed", e);
      return null;
    }
  }

  function _write(clients) {
    localStorage.setItem(KEY, JSON.stringify(clients));
    const meta = _readMeta();
    meta.lastSaved = new Date().toISOString();
    meta.syncState = meta.syncState || "local"; // local | synced | pending | offline | error
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function _readMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : { syncState: "local", lastSaved: null };
    } catch (e) {
      return { syncState: "local", lastSaved: null };
    }
  }

  // No real client data ships in this file, deliberately -- this code is in
  // the PUBLIC app repo (rkv-od-app), and real client records belong only
  // in the PRIVATE data repo (rkv-od-data), pulled in by Sync once
  // configured (see sync.js). A single clearly-fake example client seeds a
  // fresh install so the UI isn't empty before sync is set up; it is not
  // real data and says so on its face.
  function _seed() {
    return [
      {
        id: "ENG-000",
        org: "Sample NGO (edit or delete me)",
        contact: "Example Director",
        acct: null,
        status: "active",
        note: "This is placeholder data, not a real client. Once GitHub sync is configured in Settings, your real client records replace this automatically. Feel free to delete it now.",
        pilotSlot: null,
        currentStep: "0",
        stepState: {},
        tasks: {},
        clarityConfirmed: {},
        waitingOnClient: [],
        waitingOnUs: [],
        log: [{ date: Engine.todayISO(), event: "Sample client created on first install" }],
      },
    ];
  }

  function all() {
    let clients = _read();
    if (clients === null) {
      clients = _seed();
      _write(clients);
    }
    return clients;
  }

  function get(id) {
    return all().find((c) => c.id === id) || null;
  }

  // Writes to localStorage only -- used by Sync when merging a pull, so
  // that reconciling remote data doesn't itself trigger another push and
  // loop. Real user edits go through save(), below, not this.
  function saveLocalOnly(client) {
    const clients = _read() || [];
    const idx = clients.findIndex((c) => c.id === client.id);
    if (idx >= 0) clients[idx] = client;
    else clients.push(client);
    _write(clients);
    return client;
  }

  function save(client) {
    saveLocalOnly(client);
    if (window.Sync && Sync.isConfigured()) {
      Sync.pushClient(client).catch(() => {}); // failure already queued + surfaced via sync pill
    }
    return client;
  }

  function remove(id) {
    const clients = all().filter((c) => c.id !== id);
    _write(clients);
    // Note: does not delete the file from the data repo. Deleting from
    // GitHub via the API needs the file's sha and is a separate, rarer
    // action -- left as a manual step (or a v2 addition) rather than firing
    // a destructive remote delete automatically on every local remove.
  }

  // A monotonic counter, independent of who currently exists. Deriving the
  // next id from max(existing ids) would let a deleted client's id get
  // handed to a completely different organisation later -- a real problem
  // for something meant to be a permanent record. The counter only ever
  // goes up, seeded once from today's real data (ENG-000, ENG-001) so new
  // ids continue the real sequence rather than restarting it.
  const COUNTER_KEY = "od_id_counter_v1";
  function nextId() {
    let n = parseInt(localStorage.getItem(COUNTER_KEY) || "", 10);
    if (isNaN(n)) {
      let max = 0;
      all().forEach((c) => {
        const m = /ENG-(\d+)/.exec(c.id);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      n = max;
    }
    n += 1;
    localStorage.setItem(COUNTER_KEY, String(n));
    return "ENG-" + String(n).padStart(3, "0");
  }

  function pilotsUsed() {
    return all().filter((c) => c.pilotSlot).length;
  }

  function meta() {
    return _readMeta();
  }

  function exportJSON() {
    return JSON.stringify({ clients: all(), exportedAt: new Date().toISOString() }, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    const clients = parsed.clients || parsed; // accept either wrapped or raw array
    if (!Array.isArray(clients)) throw new Error("Not a valid client export");
    _write(clients);
    return clients.length;
  }

  return { all, get, save, saveLocalOnly, remove, nextId, pilotsUsed, meta, exportJSON, importJSON };
})();
