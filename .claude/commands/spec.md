---
description: Biến một ý tưởng (đã qua planner) thành design/spec cụ thể bằng spec-writer subagent — public API, type, layer, thuật toán, a11y, test plan, security.
argument-hint: <ý tưởng hoặc slug plan đã có>
---
Dùng **spec-writer** subagent để thiết kế: $ARGUMENTS

Nếu đã có `.claude/work/plan-<slug>.md`, đọc nó làm đầu vào.

Theo `.claude/agents/spec-writer.md`: định nghĩa public API (verb+noun method, past-tense
event), type + branded ID, layer đặt code (xác nhận headless-first + core không import
framework), tier (Core/Pro/Cloud/plugin), thuật toán + edge case (cycle/constraint/ngày
nghỉ/lag±/DST), Temporal cho date, a11y nếu render, security nếu input ngoài, và test plan
cho test-engineer.

Ghi spec vào `.claude/work/spec-<slug>.md`. Nếu có open question lớn thì hỏi trước khi
chốt. Chỉ viết docs — không implement.
