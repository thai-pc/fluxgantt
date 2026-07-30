---
description: Decide whether to build an idea and at which tier, via the planner subagent (Core vs Pro vs Cloud vs plugin vs don't-build, who pays, v1 scope).
argument-hint: <idea, e.g. "resource leveling">
---
Use the **planner** subagent to decide what to do about: $ARGUMENTS

It decides *whether & what*, not *how* — no API/type design (that's `/spec`).
Per `.claude/agents/planner.md`: check what already exists in the code first; decide Core
(MIT) vs Pro vs Cloud vs plugin vs don't-build (justify why paid, don't default to it); name
the persona who pays; cut a v1 scope + an explicit out-of-scope list. Grain check:
headless-first, core doesn't import a framework, bundle budget, Temporal instead of `Date`.
Remember the current Wave (Wave 1 = Core MVP).

Write the plan to `.claude/work/plan-<slug>.md` and end with a one-sentence decision. Do not
design endpoints, do not implement.
