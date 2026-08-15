/* engine.js — turns process-def.json + a client record into a task list,
 * a stage position, and an advance/gate decision. Pure functions, no DOM,
 * no storage -- store.js and app.js are the only things that touch state.
 */
const Engine = (() => {
  let DEF = null; // process-def.json, loaded once at boot
  let FLAT = null; // flattened, ordered step list across all 4 stages

  function boot(def) {
    DEF = def;
    FLAT = [];
    def.stages.forEach((st) => {
      st.steps.forEach((s) => {
        FLAT.push(Object.assign({}, s, {
          stageId: st.id, stageTitle: st.title, stageRange: st.range,
          gate: s.status === "gate" || !!s.gate,
        }));
      });
    });
  }

  function flat() { return FLAT; }
  function def() { return DEF; }

  function stepByN(n) { return FLAT.find((s) => s.n === n); }
  function indexOfN(n) { return FLAT.findIndex((s) => s.n === n); }

  function stageOfN(n) {
    const s = stepByN(n);
    return s ? s.stageId : 1;
  }

  // Combine have/send/get into one flat task list for a step. 'info'-class
  // items are shown as read-only notes, not checkable tasks. Everything
  // else becomes a tickable task, tagged with the group it came from so the
  // UI can group them under "Have in hand / Send / Get back" headers.
  function taskItems(step) {
    const groups = [["have", "Have in hand"], ["send", "Send / share"], ["get", "Get back out"]];
    const out = [];
    groups.forEach(([key, label]) => {
      (step[key] || []).forEach((pair, idx) => {
        const [cls, text] = pair;
        out.push({
          key: step.n + "|" + key + "|" + idx,
          group: key, groupLabel: label, cls, text,
          checkable: cls !== "info",
        });
      });
    });
    return out;
  }

  function isStepComplete(client, step) {
    const items = taskItems(step).filter((t) => t.checkable);
    if (items.length === 0) return true;
    return items.every((t) => client.tasks && client.tasks[t.key] && client.tasks[t.key].done);
  }

  function canAdvance(client, step) {
    if (!isStepComplete(client, step)) return false;
    if (step.gate && !(client.clarityConfirmed && client.clarityConfirmed[step.n])) return false;
    return true;
  }

  function currentStep(client) {
    return stepByN(client.currentStep) || FLAT[0];
  }

  // Marks the current step done, moves the client to the next step in the
  // flat order (setting it to "doing"), and appends a log line. Returns the
  // updated client (caller is responsible for Store.save).
  function advance(client) {
    const step = currentStep(client);
    if (!canAdvance(client, step)) return client;
    // Terminal-state guard: the last step, once marked done, must not be
    // re-advanceable. Without this, a client at the final step stays
    // permanently eligible (all tasks already ticked) and repeat calls --
    // stale UI, a second click before re-render, a future API caller --
    // would duplicate "completed" / "reached the end" log entries forever.
    const idxNow = indexOfN(step.n);
    const isLastStep = idxNow === FLAT.length - 1;
    const alreadyDone = client.stepState && client.stepState[step.n] && client.stepState[step.n].state === "done";
    if (isLastStep && alreadyDone) return client;
    client.stepState = client.stepState || {};
    client.stepState[step.n] = Object.assign({}, client.stepState[step.n], {
      state: "done", date: todayISO(),
    });
    const idx = indexOfN(step.n);
    const next = FLAT[idx + 1];
    client.log = client.log || [];
    client.log.push({ date: todayISO(), event: `Step ${step.n} "${step.title}" completed` });
    if (next) {
      client.currentStep = next.n;
      client.stepState[next.n] = Object.assign({ state: "doing" }, client.stepState[next.n]);
      client.log.push({ date: todayISO(), event: `Advanced to step ${next.n} "${next.title}"` });
    } else {
      client.log.push({ date: todayISO(), event: "Reached the end of the process" });
    }
    return client;
  }

  function progress(client) {
    const total = FLAT.length;
    let done = 0;
    const dots = FLAT.map((s) => {
      const st = (client.stepState && client.stepState[s.n] && client.stepState[s.n].state) || "pending";
      if (st === "done") done++;
      return { n: s.n, state: st };
    });
    return { done, total, pct: Math.round((done / total) * 100), dots };
  }

  function todayISO() {
    // Real clients need a real date. This is a running app (not a Workflow
    // script), so a live Date is correct and intended here.
    return new Date().toISOString().slice(0, 10);
  }

  return {
    boot, flat, def, stepByN, indexOfN, stageOfN, taskItems,
    isStepComplete, canAdvance, currentStep, advance, progress, todayISO,
  };
})();
