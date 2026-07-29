---
description: Chạy pipeline đầy đủ plan → spec → build → test → review → fix cho một ý tưởng tính năng, dùng các subagent của FluxGantt.
argument-hint: <ý tưởng tính năng>
---
Đưa một tính năng FluxGantt đi từ đầu đến cuối cho: $ARGUMENTS

Chạy các subagent tuần tự, mỗi bước dùng đầu ra bước trước (artifact ở `.claude/work/`):

1. **planner** — quyết định *whether & what*: Core (MIT) vs Pro vs Cloud vs plugin vs
   đừng-build, ai trả tiền, phạm vi v1 + out-of-scope. Ghi `.claude/work/plan-<slug>.md`.
   **Dừng lại, cho tôi xem quyết định.** Nếu là đừng-build hoặc dùng-OSS, dừng ở đó — đừng
   sang spec.
2. **spec-writer** — biến plan đã duyệt thành design (public API, type + branded ID, layer,
   thuật toán + edge case, Temporal, a11y, security, test plan) khớp grain. Ghi
   `.claude/work/spec-<slug>.md`. Cho tôi xem spec; nếu có open question lớn thì hỏi trước.
3. **gantt-core-engineer** — implement spec (đúng tier/layer, headless-first, core không
   import framework, test đi kèm). Diff gọn; `pnpm typecheck` + test liên quan.
4. **test-engineer** — viết + chạy test tới khi suite liên quan xanh (ưu tiên compute layer,
   fast-check + edge case).
5. **security-reviewer** — nếu thay đổi đụng input ngoài (IO/render/AI/Cloud), review theo
   checklist và ghi findings đánh số vào `.claude/work/review-<slug>.md`.
6. **gantt-core-engineer** (fix pass) — sửa mọi finding **Blocking** + các non-blocking rẻ &
   đúng; chạy lại typecheck + test liên quan. Báo theo số finding. Nếu phải đổi hành vi để
   sửa, đưa lại qua **security-reviewer** một lần nữa.

Sau đó tóm tắt cho tôi: quyết định tier, cái gì đã ship, kết quả test, finding nào chưa sửa
và vì sao. **KHÔNG commit/tag/push** — tôi tự làm bước release (changeset trước mỗi thay đổi
public).
