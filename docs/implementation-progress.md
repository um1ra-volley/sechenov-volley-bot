# SDD ledger — plan: docs/superpowers/plans/2026-10-17-sechenov-volley-bot.md

Execution: native in this session, explicitly selected by owner. Spec approved. No local project files.

Ruling: Remote GitHub branch codex/implement-bot replaces local worktree and local skill workspace — owner forbids local files — cost if wrong: isolation and progress must be recovered from remote commits.

Pre-flight:
- Tasks 1→2: State and event/date types consumed by commands and storage; define in src/core/model.ts.
- Tasks 2→3: synchronize emits state changes through serializable commands; no network in reducers.
- Tasks 3→4: revision and attendanceRevision travel with every notification; stale jobs suppressed.
- Tasks 2/4→5: successful UI acknowledgement only after durable state commit.
- Tasks 1–5→6: all ports synchronous, Apps Script entry points return actual outputs.

Task 1: in progress; BASE 759afc54d01a216d3223b1eb227caa2b7f9bd318.
Tasks 2–6: pending.

Task 1 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035056427 — npm test: 9 failed, missing date/training/state behavior as intended.
