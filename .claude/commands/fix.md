---
description: Áp dụng các finding từ review bằng gantt-core-engineer subagent, rồi chạy lại typecheck + test liên quan.
argument-hint: [findings hoặc slug; trống = review-*.md mới nhất trong .claude/work/]
---
Dùng **gantt-core-engineer** subagent để sửa các finding: $ARGUMENTS

Nếu $ARGUMENTS trống, đọc file `.claude/work/review-<slug>.md` mới nhất làm danh sách finding.

Áp dụng mọi finding **Blocking**, cộng các non-blocking rẻ & đúng. Theo grain FluxGantt
(headless-first, core không import framework, Temporal, branded ID, tree-shakable, tier-gate).
Chạy lại `pnpm typecheck` + test liên quan cho tới khi xanh. **Báo theo số finding** (đã sửa
/ bỏ qua + lý do). Nếu phải đổi hành vi để sửa, nói rõ để đưa lại qua security-reviewer.

Không commit/tag/push.
