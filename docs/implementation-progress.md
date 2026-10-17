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

Task 4: complete (commits c90a47f..045fb5d; npm test 51/51, typecheck passed; regression RED→GREEN; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39036695031).
Task 5: in progress; BASE 045fb5d2bdaf7f5c763c14ff75142e933a877296.

Task 5 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39036935570 — 51 passed, 18 failed because Telegram handler was absent.

Task 5: complete (commits 045fb5d..47fc248; npm test 69/69, typecheck passed; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39037152938).
Task 6: in progress; BASE 47fc248cf1a1c92e215219afbc92776a84cd2661.
Additional boundary checks: stale-source labels, midnight Moscow move, post-start owner correction, useful audit details and archival are included before runtime build.

Task 6 RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39037598592 — 69 passed, 10 failed: runtime/build/archive absent and four operational boundaries reproduced.
Task 6 cache RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038079575 — extra snapshot-read test failed. Without request-scoped reuse, six full reads × 12 calls × 288 idle ticks would exceed 20,000 URL Fetch/day. Fix reuses unchanged blobs in memory after checking current Git head on every read.
Task 6 bootstrap RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038382238 — real-storage smoke stopped before any write because initialise was absent.
Boundary root causes: source menus omitted health labels; training validation compared UTC date with Moscow date; past-RSVP guard did not exempt owner corrections; audit UI omitted old/new answers and target name. Each has its own failing test before these changes.
Ruling: cloud tests require commits on the isolated feature branch before execution — owner forbids local execution/files — cost if wrong: intermediate unverified commits exist only on the feature branch; merge and launch remain gated by CI and review.
Ruling: initial Google publication uses the reviewed GitHub artifact directly in the browser — avoids local OAuth credential files — cost if wrong: automatic CI publication needs a separate Google OAuth setup; manual version updates remain available.

Task 6 live bootstrap failure: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038671311 — metadata GET with trailing slash returns 404. Confirmed with direct authenticated requests: canonical repository route succeeds, slash-suffixed route fails. Regression RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038783245 — 80 passed, canonical bootstrap failed. Fixed shared API URL builder for empty relative path.

Task 6: code verification complete (commits 47fc248..da8345e; npm test 81/81, strict typecheck and Apps Script build passed; https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038899166). Real private GitHub API transaction smoke passed with two simultaneous workers and confirmed both commands survived a forced same-parent conflict; synthetic branch removed: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39038899143.
Task 6 deployment acceptance pending: Google OAuth, protected secret entry and actual deployed HTTP/Telegram checks are not performed. CI and build are not a production launch.
Final review: fresh-context read-only whole-branch review dispatched for 759afc5..da8345e, including the plan's five Review Focus cases and every Ruling.

Final review: five Important findings, no Critical or retained Minor findings, Declined to judge empty. Fix pass: existing-profile owner bootstrap; concurrent training exceptions; short Google Values rows; terminal delivery retries; archived source reimport. Reproduce each before implementation.

Final fix-pass RED: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39039484255 — eight failing regressions reproduce all five findings (bootstrap, three concurrent training cases including real repository CAS replay, shortened rows, two terminal-delivery cases, archive reimport). Eligibility cancellation positive control remains green.
Final: Ruling: archived source rows remain immutable historical snapshots; only an explicit future scheduled/postponed instance restores the same ID with increased event and attendance versions — prevents old source rows from undoing archival or reviving stale buttons — cost if wrong: corrections to already-past source rows require deliberate archive/operator handling rather than automatic historical rewrites.

Final: fixed owner bootstrap after ordinary /start — existing-profile owner promotion and single-owner test RED→GREEN, suite 90/90.
Final: fixed stale training synchronization — cancel/move interleavings and Git CAS replay RED→GREEN, suite 90/90.
Final: fixed truncated Google Values rows — omitted venue/status normalization RED→GREEN, suite 90/90.
Final: fixed exhausted and permanent delivery reset — 500 retry exhaustion and 400 terminal failure RED→GREEN, eligibility cancellation control green, suite 90/90.
Final: fixed archived event reimport — repeated source reads leave historical game archived; explicit future restoration increments both versions RED→GREEN, suite 90/90.
Final verification: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39039562333 — exact implementation commit 0438ee794b792ba3da94dfa6d2703a145ed65f12, strict typecheck, build, 90 tests passed. Real concurrent GitHub API smoke passed and removed its synthetic branch: https://github.com/um1ra/sechenov-volley-bot/actions/runs/39039562361.
Final: minor (deferred): none. Declined to judge: empty. No further review dispatch; the single fix pass is verified by regression tests and full suite.
Google preparation: private owner-only Apps Script project created at https://script.google.com/home/projects/1XrxZwArTrWqUvYVW9_49c9P8M4Bn_bNaGaCUilxXT3Nuz_EM2mdhP_5J/edit. Code and manifest transferred in memory through browser UI; no local source/artifact files. Non-secret runtime settings saved. No credentials entered, OAuth granted, public deployment created, runtime activated or real Telegram messages sent.
