---
description: Implement một tính năng/fix trong @fluxgantt/core bằng gantt-core-engineer subagent, theo đúng convention repo + test đi kèm.
argument-hint: <việc cần làm, hoặc slug spec đã có>
---
Dùng **gantt-core-engineer** subagent để implement: $ARGUMENTS

Nếu đã có `.claude/work/spec-<slug>.md`, đọc nó làm đầu vào.

Theo `.claude/agents/gantt-core-engineer.md`: giữ headless-first (store/compute không DOM),
core không import react/vue/svelte, Temporal cho mọi tính toán date, TypeScript strict +
branded ID, tree-shakable trong budget, tier-gate đúng chỗ (không nhét Pro/Cloud vào core),
naming/file-layout theo coding-conventions. Diff gọn, đúng layer. **Viết test đi kèm**, chạy
`pnpm typecheck` + test liên quan, báo kết quả thật.

Không commit/tag/push — đó là bước người dùng làm.
