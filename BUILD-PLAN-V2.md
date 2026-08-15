# OD Dashboard v2 — the self-contained build (scoped 15 Aug 2026, with Rahul)

## The correction driving v2 (Rahul, verbatim intent)
The app must be COMPLETE IN ITSELF — every document, package, instruction
inside it, nothing referencing Claude-workspace files/agents/memory. The
Claude system produced the content; the app must carry it independently.

## Decisions locked
1. TEMPLATES: Claude writes EVERY gap document as a real, complete,
   ready-to-use template living in-app (view/copy/download). Rahul reviews
   each before it is marked final. List: proposal, Terms of Reference
   (with case-study consent + access clauses, 50/50 payment w/ tranche-2 on
   handover), interview guide, document-request checklist, capacity
   assessment (Marguerite Casey OCAT adaptation), observation protocol +
   interviewee confidentiality note, diagnostic report template,
   facilitation plan, action plan + roadmap + impact/effort grid, engagement
   brief, holding reply, handover pack + ownership matrix + review calendar,
   case-study request, lesson log, Touch-3 value artifact.
2. TAILORING: issue-based playbooks keyed to the 5 intake issue types
   (Mis-Communication, Project Inefficiency, Lack of team Management,
   Lack of role Clarity, Workflow Issue). Client's intake issue selects
   which playbook their steps surface.
3. LANGUAGE: English primary. Architecture supports per-client language
   add-ons per document (Hindi/Bengali/Gujarati...) added later on demand.
4. INTEGRATIONS: LOCKED 15 Aug — smart links now, APIs later. Gmail
   compose + Google Calendar template links + Calendly (URL set in
   Settings) SHIPPED in M6. ClickUp relay (Cloudflare Worker) is the
   designated later project if practice proves the need. Gmail full API advised
   against (Google restricted-scope verification; 7-day test tokens).
   ClickUp full API requires a Cloudflare Worker relay (CORS) — possible,
   own-account, separate project if chosen.
5. JARGON PURGE: complete the sweep — no .md filenames, agent names, or
   workspace paths anywhere in UI text (36 replaced 15 Aug; finish rest).

## Also shipped 15 Aug (context for whoever reads this next)
- Form-wipe fixed 3 ways: focus-pull skips open forms; intake drafts
  autosave every keystroke (survive reload/desktop-switch/close); pulls
  skip unchanged files (sha compare) so no-change = no re-render.
- Tick-undone race fixed: in-flight push guard; scroll preserved on
  same-view re-render (checkbox no longer jumps the page).
- Settings moved behind the gear icon (top-right) off the main nav.
- Colour legend on Home + client detail (green done / orange in progress /
  red blocked / grey not started). Baseline + comms-model fields now carry
  plain-language explanations and examples in-field. AKL source code
  auto-fills next number, editable.

## Build order for v2
M6 DONE 15 Aug: templates engine + doc viewer (copy/download/client
substitution) + first 4 drafts (proposal, ToR, interview guide, capacity
assessment — ALL AWAITING RAHUL REVIEW) + smart links row.
M7 DONE 15 Aug: ALL 16 documents now written in-app, every step 0-14
covered (call structure, holding reply, touch-3 value, engagement brief,
doc checklist, confidentiality note, diagnostic report, feedback
facilitation plan, action plan, handover pack, case-study request,
lesson log + the M6 four). ALL ARE DRAFTS AWAITING RAHUL REVIEW -- each
carries the red banner until he approves it and a session marks it final.
NEXT: M8 issue-based playbooks -> M7 all remaining docs ->
M8 issue playbooks wiring -> M9 integrations (per Rahul's pick) ->
M10 language add-on architecture + full jargon purge + review pass.
