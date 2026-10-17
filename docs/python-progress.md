# SDD ledger — plan: docs/superpowers/plans/2026-10-17-python-server.md
Ruling: reuse the approved functional architecture and inline execution approval — the user explicitly requested immediate Python implementation; repeating the design/plan handoff would repeat existing authorization. Cost if wrong: implementation may need adjustment to the server's deployment preferences.
Ruling: remote feature branch and in-memory tests replace a local worktree/ledger workspace — user prohibits local source files. Cost if wrong: network failure can interrupt work; committed GitHub history remains recovery.
Ruling: Python preserves the existing state section layout and adds polling/lease metadata — no current data branch exists, but existing state is never silently reset. Cost if wrong: cross-runtime migration requires an explicit takeover and compatibility validation.
Pre-flight: domain and transport share notification IDs, attendanceRevision and cursor; GitHub reducer callbacks must be replay-safe and perform no HTTP. Updater never checks out or resets the data branch.
Task 1: in progress — write failing Python behavior tests before production code.
