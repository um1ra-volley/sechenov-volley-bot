# SDD ledger — plan: docs/superpowers/plans/2026-10-17-python-server.md
Ruling: reuse the approved functional architecture and inline execution approval — the user explicitly requested immediate Python implementation; repeating the design/plan handoff would repeat existing authorization. Cost if wrong: implementation may need adjustment to the server's deployment preferences.
Ruling: remote feature branch and in-memory tests replace a local worktree/ledger workspace — user prohibits local source files. Cost if wrong: network failure can interrupt work; committed GitHub history remains recovery.
Ruling: Python preserves the existing state section layout and adds polling/lease metadata — no current data branch exists, but existing state is never silently reset. Cost if wrong: cross-runtime migration requires an explicit takeover and compatibility validation.
Pre-flight: domain and transport share notification IDs, attendanceRevision and cursor; GitHub reducer callbacks must be replay-safe and perform no HTTP. Updater never checks out or resets the data branch.
Task 1: in progress — write failing Python behavior tests before production code.

Ruling: user explicitly stopped testing and asked to review ready repositories and implement. No further test runs or new test files; prior 33-case RED and partial domain run were before this instruction. Cost: Python runtime and deployment will be delivered after static review, without execution proof.
Ruling: use aiogram 3.31.0 (MIT) as the Telegram client, following its official examples. Existing templates with SQLite/Postgres do not satisfy GitHub-only business storage; reuse the library and keep the agreed state adapter. Cost: project-specific schedule and attendance rules still need custom Python code.

Task 1: implemented CSV sources, Moscow dates, registration/owner approval, subscriptions, response history, training exceptions, changes, deduplicated invitations/reminders and archives.
Task 2: implemented GitHub CAS with fresh-state replay and private-repository guard; aiogram API client; durable polling cursor, process lease and outbox. No runtime execution after the user's no-tests instruction.

Task 3: implemented aiogram polling, explicit webhook disable preserving updates, init/check/takeover/health commands and environment loading. Process is not started on the owner's Mac.

Task 4: Docker/Compose, secret template, server credential helper and optional systemd updater added. Candidate image is built before cutover; rollback preserves the data branch. README includes owner setup, migration and deployment commands.
Task 5: static review in progress. User requested no test runs; no Python test files or automatic Python CI workflow added.

Static inspection: compare owner bootstrap secrets as UTF-8 bytes, so a non-ASCII invalid command is rejected rather than becoming an unprocessable update. No behavior tests were run for this change, per user instruction.

Task 5: completed one independent static review; accepted all three Important findings (per-row CHM integrity, admin answer revision, queued event-card revalidation). Added immutable initial Compose rollback snapshot and UTF-8 secret comparison from own inspection. See docs/python-static-review.md. No declined findings or Declined-to-judge items. Syntax inspection only; no final runtime/test claims.
Ruling: do not create a PR against main because the inherited pull_request workflow would run npm test. Cost: Python remains in codex/python-server until the owner chooses integration; server instructions explicitly use that branch.

Integration: the owner explicitly requested main. Server instructions, systemd CODE_BRANCH and updater default now use main; the data branch remains codex/bot-data. Publish with [skip ci] to honour the no-tests instruction. Keep both feature branches and their history. No local source files or server deployment.
