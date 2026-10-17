# Python server implementation — 17 October 2026

Binding specification: existing approved Sechenov volley design, with the user's server/Python correction.

Outcome: real bot.py on Python 3.12+, no Node or Google Apps Script runtime, running on the friend's always-on server. Standard library HTTP, CSV, timezone and GitHub Git API. Existing Telegram identity and private GitHub business-state schema retained; no credentials in source.

1. Test-first pure domain: CSV parsing (three owned sheets and exact-team CHM), Moscow dates, subscriptions/approval, attendance versions, changes, 7-day invitations/one follow-up/24-hour reminders, named statistics, training exceptions and archives.
2. Test-first infrastructure: GitHub atomic commits/CAS replay/runtime fencing, durable Telegram cursor and outbox, process lease, bounded HTTP error handling. Preserve unknown manifest fields and existing state; fail closed on corrupt/public/unrecognised storage.
3. Implement polling entry point and dry-run checks; no polling, production writes or Telegram messages from the owner's Mac.
4. Docker build/test/runtime with healthcheck, non-root process and explicit secret path. Server updater builds a candidate before switching, keeps previous image for rollback, never resets the data branch. Systemd timer for optional automatic updates.
5. CI for Python and unchanged TypeScript suite, archive package, one independent whole-branch review and regression fixes. Draft PR, no merge or server deployment without actual server access.

Global constraints: private um1ra-volley/sechenov-volley-bot, branch codex/python-server based on codex/implement-bot. No local project files; code and tests are held in memory and committed via GitHub API. Keys only in the existing private secrets.env. Do not acquire Telegram updates or seed production state during development.

Sources: owned spreadsheet 1qoniSvNsRrRpxPycM8vqMcZq7gvO7lcGLYdjrEz0L3k, gids MSSI 829855182 / LVL 11476290 / LCHB 543095078, header row 5. CHM spreadsheet 1WKhrg8yCAgbkB1bBg7XPv78H1z772IesmB8aKJYBh_Q, gid 2047287896, season 2026/2027, exact Сеченовский университет filter. CSV exports currently readable without credentials; failures freeze the last snapshot, never change sharing permissions.

Review focus: two concurrent replies and failed CAS; crash after Telegram accepts a message; offset advancement after durable commit; subscription/version changes between enqueue and send; malformed/empty CSV vs actual removed row; old runtime waking after takeover; updater rollback without resetting GitHub data.

## User correction during implementation
Use a reviewed ready Telegram framework (aiogram 3.31.0). Stop tests and CI runs. Deliver Python code, Docker/server instructions and an independent static review. Earlier test artifacts are not a claim that the final server runtime has been run.

## Owner-authorized integration
The owner subsequently requested main. Integrate the Python branch into main, preserving its history, and set server deployment/updater defaults to main. Skip CI for this integration; no test or bot execution. Feature branches remain available.
