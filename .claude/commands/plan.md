---
description: Quyết định có nên build không & build ở tier nào cho một ý tưởng, bằng planner subagent (Core vs Pro vs Cloud vs plugin vs đừng-build, ai trả tiền, phạm vi v1).
argument-hint: <ý tưởng, vd "resource leveling">
---
Dùng **planner** subagent để quyết định làm gì với: $ARGUMENTS

Nó quyết định *whether & what*, không phải *how* — không thiết kế API/type (đó là `/spec`).
Theo `.claude/agents/planner.md`: xem code đã có gì trước; quyết định Core (MIT) vs Pro vs
Cloud vs plugin vs đừng-build (biện minh vì sao paid, đừng mặc định); nêu persona ai trả
tiền; cắt phạm vi v1 + out-of-scope tường minh. Grain check: headless-first, core không
import framework, bundle budget, Temporal thay `Date`. Nhớ Wave hiện tại (Wave 1 = Core MVP).

Ghi plan vào `.claude/work/plan-<slug>.md` và kết bằng quyết định một câu. Không thiết kế
endpoint, không implement.
