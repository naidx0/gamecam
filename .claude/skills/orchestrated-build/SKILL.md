---
name: orchestrated-build
description: >-
  Run a large, multi-phase engineering effort end-to-end at a fraction of the
  token cost by tiering models: the expensive session model acts ONLY as
  orchestrator, cheap agents explore, Opus agents build in phase-gated waves
  with hard file-ownership boundaries, every gate is independently re-verified,
  and an external reviewer (Codex) runs an adversarial fix-then-re-review loop
  until RELEASABLE. Use this whenever the user asks for a big redesign,
  refactor, migration, or feature program — especially phrases like "make X
  first class", "do this all in one go", "take it to the finish verified",
  "use subagents for the building", or any task that clearly spans many files
  and needs multiple work sessions' worth of changes. Also use it when the user
  worries about token cost on a large task.
---

# Orchestrated Build

Deliver a large engineering effort in one continuous run, verified, without
burning the expensive model's tokens on file dumps and edits. The core insight:
the frontier model's judgment is worth its price; its file-reading is not.
Everything below exists to keep the expensive context small and the cheap
contexts busy.

## Role assignment (do this first)

- **You (the session model)** = orchestrator only. You never Read large files,
  never Edit code, never run long test suites just to watch them scroll. You
  synthesize, decide, dispatch, and verify. Your context should contain plans,
  agent reports, and gate results — not source code.
- **Exploration** = cheapest adequate tier (Sonnet or Haiku), `Explore`
  agents, run in parallel, read-only.
- **Building** = Opus (`general-purpose` agents, `model: opus`). Best
  execution-per-dollar for real code changes. Run in background
  (`run_in_background: true`) so you keep orchestrating.
- **Adversarial review** = an external, non-Claude reviewer if available
  (e.g. the `codex:adverserial-review` agent). A different model family shares no
  blind spots with the builders — it catches what the builders' cousins won't.
  If no external reviewer exists, use Opus with an adversarial prompt, but
  expect weaker independence.

Track phases with TaskCreate/TaskUpdate and dependencies (`addBlockedBy`) so
nothing launches before its prerequisites pass.

## Stage 1 — Parallel exploration (cheap, wide)

Launch 2–4 Explore agents in ONE message, each with a distinct lens (e.g. the
UI surface, the API surface, the user-facing flows). Require structured
markdown reports with file paths and line numbers, "raw data, no fluff."
Explicitly ask each for awkwardness/duplication/dead-capability observations —
subagents notice things you didn't ask about only if invited to.

You read three summaries instead of three hundred files. That asymmetry is
where most of the savings live.

## Stage 2 — Plan with hard endings

Write the plan to a repo doc (`docs/<effort>-plan.md`) containing:

1. **One goal sentence** — the end state, measurable.
2. **Phases as internal build order, not releases.** Each phase gets a
   *"Done when:"* paragraph listing concrete, checkable outcomes and the
   tests that prove them.
3. **A standing gate** — the exact commands (typecheck, build, test suites)
   that must pass after every phase. If the project has no test harness,
   Phase 1 creates one (e.g. Vitest + Testing Library); "verified" is
   meaningless otherwise.
4. **A final gate** — clean-install full run, adversarial review loop,
   route/reference checklist, scope confirmation (nothing changed outside the
   intended directories).

## Stage 3 — Build in phase-gated waves

Sequential phases; parallelize within a wave only when file ownership can be
made disjoint.

**Builder prompt anatomy** (every builder gets all of these):

- *Context*: the verified facts from exploration relevant to its phase — file
  paths, patterns, prior-phase outcomes. The builder must not re-discover what
  you already know.
- *Deliverables*: numbered, specific, with backend/API ground truth named
  ("read router X before matching request shapes").
- *Hard file-ownership boundary* when agents run concurrently: an explicit
  may-touch list AND a must-not-touch list, plus what the other agent is doing.
  Design the split so shared files (route tables, UI kits, global CSS) belong
  to exactly one agent — the other reuses, or appends under a named comment
  marker, or creates a local file instead.
- *Foreign-failure protocol*: "if gate failures are exclusively in files you
  don't own, note them and move on — the orchestrator runs the authoritative
  gate after all agents finish." Without this, concurrent agents deadlock
  fixing each other's in-progress work.
- *The gate commands* to run before finishing, and a required final-report
  format (files changed, tests added, gate output tail, deviations and why).
- *No commits* unless the user asked.

**After every wave, re-run the gate yourself.** Agent self-reports are
necessary but not sufficient — a one-minute authoritative re-run catches
stale-tree races between concurrent agents and keeps the whole chain honest.

## Stage 4 — Adversarial review loop (the quality engine)

This loop is what turns "it compiles and tests pass" into "releasable." Every
real bug it catches in practice is a logic/timing/contract bug invisible to
typecheck and the builders' own tests.

Repeat until clean:

1. **Review round N**: external reviewer reviews the full diff. The prompt
   must include: intent doc, what the diff consists of (git diff + untracked
   paths), named ground truth (backend routers, specs), specific hunt
   categories (bugs, broken routes, regressions vs HEAD, guard gaps, dead
   code, test quality), "do NOT fix — report only," severity + file:line +
   concrete failure scenario per finding, and — after round 1 — the list of
   prior fixes to re-verify with *specific attack angles you devise* (stale
   closures, cascade order, concurrent-render semantics, error branches).
   Require an explicit RELEASABLE / NOT RELEASABLE verdict and "do not invent
   findings — if clean, say so plainly."
2. **Triage yourself.** Not every finding is a bug. Some are design decisions
   — when the flagged behavior is actually correct (e.g. asymmetric error
   codes that avoid information leaks), rule it *intended*, have it documented
   in-code and pinned with tests for both branches, and tell the next review
   round it is settled and NOT a finding. Otherwise the loop never converges.
3. **Fix pass** (Opus): findings verbatim PLUS your own root-cause analysis
   and known pitfalls ("don't reuse the load sequence for the action guard or
   busy sticks forever"). Every fix requires a locking regression test; no
   weakened assertions. Scope each fix minimally.
4. **Re-run the gate yourself**, then launch review round N+1, scoped tighter
   each round (later rounds: only the code the fixes touched; earlier areas
   are settled — say so).

Healthy convergence looks like 7 → 4 → 3 → 2 → 1 → 0 findings, each round's
findings being refinements of earlier fixes rather than new territory. If
findings aren't narrowing, the fixes are treating symptoms — step back and fix
the root cause once (e.g. guard the shared loader itself instead of patching
every call site).

## Communication

The user sees your text, not the agents'. After each wave/round, relay: what
landed, the verified gate numbers, what's running now, and what happens next.
Lead with the outcome. Flag scope changes prominently (e.g. "the plan said
zero backend changes; here is the one exception and why") and update the plan
doc so it stays truthful.

## Why this is cheap (and when it isn't)

The expensive model pays for judgment tokens only; a ~2M-token build costs a
few dollars when 90% of it runs on Opus/Sonnet and reviews are external. The
main residual cost is the orchestrator's own cache misses while waiting on
long agent runs — keep your turns lean and don't poll.

Skip this skill for small tasks: single-file fixes, quick questions, or
anything one builder could finish in one sitting. Orchestration overhead only
pays for itself when the work spans many files, needs parallelism, or must
survive an adversarial quality bar.
