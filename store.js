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

  // No seed data at all, deliberately -- twice over. (1) This code is in
  // the PUBLIC app repo, so real client data can never ship in it. (2) The
  // earlier fake "Sample NGO" placeholder got auto-pushed to the real data
  // repo by the stranded-client flush on 15 Aug -- fake data polluting real
  // records. A fresh install now starts genuinely empty; the home view
  // explains the two ways to begin (add a client, or configure sync and
  // pull existing records).
  function _seed() {
    return [];
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

  // Collision-proof ids. The old scheme (ENG-001, ENG-002...) minted the
  // next number from local state -- two devices offline at the same moment
  // would both mint ENG-003 for two different organisations, and sync's
  // per-id files would then silently merge them into one. Timestamp base36
  // plus random suffix cannot collide across devices in practice, and old
  // ENG-NNN ids remain perfectly valid alongside.
  function nextId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 4);
    return `ENG-${t}${r}`.toUpperCase();
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
