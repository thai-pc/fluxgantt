---
description: Viết + chạy test cho một thay đổi bằng test-engineer subagent tới khi suite xanh — ưu tiên compute layer (critical path, leveling, calendar).
argument-hint: [cần test gì, vd "critical path lag âm" hoặc để trống = thay đổi hiện tại]
---
Dùng **test-engineer** subagent để test: $ARGUMENTS

Nếu $ARGUMENTS trống, test thay đổi chưa commit (`git status` / `git diff`).

Theo `.claude/agents/test-engineer.md`: ưu tiên **compute layer** (CPM đối chiếu reference
MS Project, fast-check kiểm bất biến, edge case cycle/constraint/ngày nghỉ/lag±/DST), rồi
state (delta đúng, không emit thừa, undo/redo), IO round-trip, render visual, e2e
interaction, a11y WCAG 2.1 AA. Test chạy headless, fake timer, nhiều timezone + DST. Đặt
test đúng chỗ, file `*.test.ts` kebab-case.

**Chạy test thật** (`pnpm -r test` hoặc scope package) và báo kết quả trung thực — fail thì
dán output, không khẳng định "đã pass" khi chưa chạy.
