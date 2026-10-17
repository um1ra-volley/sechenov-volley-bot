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

Admins change (17 October 2026): owner explicitly requested multiple bot admins in main. Bounded extension of existing roles: owner alone assigns/removes admin through /admins; approved admins share statistics, participation edits, approval, trainings and operational commands. Existing owner/member records preserved; no live user roles changed during development.
Ruling: no shared admin password — owner chooses an approved Telegram ID from the existing registered-user list. Cost if wrong: the first owner must be available to delegate access.
Ruling: keep user instruction against tests/local files; static syntax/read-through only, publish directly to main with [skip ci] as explicitly requested.
Privacy: found repository public during read, restored the previously requested private visibility and verified dmitriyg0r retained repository admin access.

Role changes increment roleRevision to reject stale/duplicate/ABA buttons. Staff outbox replies carry requiredRole and are rechecked at delivery; revocation cancels legacy queued staff dialogs and clears pending training actions. Admin access cannot be withdrawn through an old approval callback.

Final role review: independent static reviewer found no consequential Critical/Important/Minor findings; Declined-to-judge []. Own final read found historical source health operations could be sent to a newly promoted admin; fixed by recording adminSince and filtering source incidents before that grant. No tests, imports, bot or Docker executed. Syntax inspection and GitHub readback only. Review details: docs/admins-review.md.

New user correction (17 October 2026): entering a valid full name grants access automatically to anyone opening the bot, including existing named profiles with legacy pending/rejected status. Remove request approval from menus and retire old approve callbacks/queued cards. Owner/admin privileges remain separate and unchanged. All live data transitions happen only when the updated server handles an update or runs its scheduler, not during development.
Repeated attendance reminders: replace the single follow-up with a durable daily cycle. Use the latest automatic question delivery/attempt as the 24-hour anchor; create one current follow-up, skip missed catch-up bursts, stop after a current answer, unsubscribe, cancellation or event start. Pending prompts prevent duplicate queues. An uncertain delivery is not retried automatically; a new scheduled question is allowed 24 hours later.
Ruling: preserve the user's no-tests/no-local-source constraints; static syntax/read-through only. Main remains the delivery branch; publish with [skip ci].

Independent static review of d41c834..ada6785 found no consequential Critical/Important/Minor issues, Declined-to-judge []. Reviewed admission, stale approval retirement, daily anchor/key and pending guards, final delivery role/answer/version checks, mandatory day notice and persisted legacy metadata. Training '2 before' unit is still pending the user's required clarification and unchanged by this independent patch. No tests or production calls.

Training clarification: user confirmed 'за 2 дня'. Add one training_2day reminder at start minus 48 hours for every training subscriber, even after yes/no. It merges with changes, weekly/day/daily notices where coincident. Preserve weekly invitations, daily unanswered followups and mandatory 24-hour reminder; games do not get this extra notice. Monday 19:30 -> Saturday 19:30 MSK; Thursday 19:30 -> Tuesday 19:30. Main update still without tests or local sources.

Next-week schedule button (17 October 2026): owner requested a button for next week's games. Add «📆 Игры на следующей неделе» and /nextweek, computing the next Monday through Sunday from Moscow-local today. Use the existing subscription/status/event-card checks; trainings remain separate. Empty result names the next-week period. No notification schedule, roles or live data changes. User's no-tests/no-local-source constraints preserved.

Additional steering: user reported CHM import error and requested one All button in place of per-league selection, plus a complete notification schedule in chat. Read the actual Google sheet via read-only browser selection A1:AR300. Root cause: standings numeric IDs at rows 4–9 were rejected as malformed game rows before schedule header at row 11. Limit CHM parsing to the unique A/E/I/S schedule header; preserve strict validation inside the game section and exact team filter. Split safe transport-vs-format source diagnostics. All selector toggles the four leagues only and preserves separate training subscription; legacy individual buttons refresh the grouped dialog. No actual user subscriptions, Telegram messages or server commands sent during development.
