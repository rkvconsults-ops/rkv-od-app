# The OD Dashboard

RKV Consulting's internal OD engagement tracker. Plain HTML/CSS/JS, no build
step, no framework, no dependencies.

**What it does:** tracks OD clients through the 14-step engagement process —
intake, task lists per stage, the CLARITY gate before solution design,
document tracking, a live dashboard. Data is local-first (works fully
offline) and syncs to a private companion repo (`rkv-od-data`) via the
GitHub Contents API once a token is configured in Settings.

**Running it:** open `index.html` directly, or serve the folder with any
static file server. No install, no `npm`, nothing to build.

**Privacy:** this repo (`rkv-od-app`) is the app shell only — code, no
client data, safe to be public (required for free GitHub Pages). All real
client information lives in a separate *private* repo, never here.

Built for a solo OD/C4D consulting practice. Internal tool, not for
redistribution.

&copy; 2026 Rahul K. Vimal &middot; RKV Consulting.
