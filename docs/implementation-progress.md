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

Task 1: complete (commits 759afc5..9245f3d; npm test 9/9, typecheck passed; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035189342).
Task 2: in progress; BASE 9245f3d30188658d41099609c49edfff90ad4dd5.

Task 2 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035407394 — 9 passed, 16 failed for missing reducer and repository.

Task 2: complete (commits 9245f3d..5845b64; npm test 25/25, typecheck passed; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035557379).
Task 3: in progress; BASE 5845b64d6cca7d119c8a474d6a51e72c7603d5e5.

Task 3 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035791469 — 25 passed, 11 failed because source normalization and sync were absent.
Ruling: successful unchanged-source heartbeat is persisted at most once per 15 minutes — prevents empty five-minute commits while recording health in GitHub — cost if wrong: displayed last verified timestamp can lag by 15 minutes.

Task 3: complete (commits 5845b64..c90a47f; npm test 36/36, typecheck passed; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39035938754).
Task 4: in progress; BASE c90a47fcd0b997d45f079d54389531bbfd334458.

Task 4 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39036145229 — 36 passed, 14 failed for missing notification/delivery behavior.

Task 4 regression RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39036622418 — 50 passed, one failed: answered queued follow-up was sent. Root cause: canDeliver rechecked subscription and revision but not a newly received answer. Fix: recheck valid current answer for follow-up before claim and before HTTP send.
