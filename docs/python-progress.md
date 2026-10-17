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
