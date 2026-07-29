# FluxGantt subagents

Subagent phạm vi dự án cho Claude Code. Mỗi agent là một chuyên gia có tool riêng + system
prompt nạp sẵn convention FluxGantt (headless-first, framework-agnostic core, Temporal,
branded ID, tree-shakable bundle budget, tier-gate Core/Pro/Cloud, checklist security). Claude
Code tự phát hiện chúng từ `.claude/agents/`.

| Agent | Vai trò | Tools | Sửa code? |
|---|---|---|---|
| **planner** | Quyết định *whether/what*: Core (MIT) vs Pro vs Cloud vs plugin vs đừng-build, ai trả tiền, phạm vi v1. Không thiết kế API. | Read/Grep/Glob/Write/Web | viết plan doc |
| **spec-writer** | Biến ý tưởng thành design cụ thể (API, type/branded-ID, layer, thuật toán, a11y, security, test plan) khớp grain — trước khi code. | Read/Grep/Glob/Write/Web | viết docs |
| **gantt-core-engineer** | Implement feature/fix trong `@fluxgantt/core` theo đúng pattern repo. Cũng chạy fix pass sau review. | Read/Edit/Write/Bash/Grep/Glob | có |
| **security-reviewer** | Review bảo mật (XSS render, parsing untrusted/XXE, AI prompt-injection, Cloud authZ). | Read/Grep/Glob/Bash | không (báo cáo) |
| **test-engineer** | Viết + chạy test theo pattern repo tới khi suite xanh. Ưu tiên compute layer. | Read/Edit/Write/Bash/Grep/Glob | chỉ test |

## Quy trình gợi ý cho tính năng không tầm thường

```
planner → spec-writer → gantt-core-engineer → test-engineer → security-reviewer → gantt-core-engineer (fix) → (bạn) changeset + commit
```

1. **planner** quyết định có build không, tier nào (Core/Pro/Cloud/plugin), ai trả tiền,
   phạm vi v1 → `.claude/work/plan-<slug>.md`. Dừng nếu là đừng-build hoặc dùng-OSS.
2. **spec-writer** ra design (API, type, layer, thuật toán, a11y, security, test plan) →
   `.claude/work/spec-<slug>.md`.
3. **gantt-core-engineer** implement (đúng tier/layer, headless-first, test đi kèm).
4. **test-engineer** viết + khóa test, làm suite liên quan xanh (ưu tiên compute layer).
5. **security-reviewer** review read-only nếu đụng input ngoài (IO/render/AI/Cloud), ghi
   findings đánh số **Blocking**/non-blocking vào `.claude/work/review-<slug>.md`.
6. **gantt-core-engineer** (fix pass) áp dụng finding Blocking + chạy lại typecheck/test;
   báo theo số finding.
7. Bạn (main session) làm bước release: **changeset trước mỗi thay đổi public**, rồi commit.
   Subagent **không bao giờ** commit/tag/push.

Các bước chạy **tuần tự**, không song song: reviewer cần suite xanh để review, fix pass cần
findings của reviewer. Artifact bàn giao nằm ở `.claude/work/` (gitignored) — mỗi bước trao
một file thay vì suy lại diff từ đầu.

## Cách gọi

- **Slash command** (`.claude/commands/`) — cách nhanh:
  | Command | Chạy |
  |---|---|
  | `/plan <ý tưởng>` | planner → quyết định tier / build-embed-skip |
  | `/spec <ý tưởng>` | spec-writer → design doc |
  | `/build <việc>` | gantt-core-engineer → implement |
  | `/test [gì]` | test-engineer → viết + chạy test xanh |
  | `/review [gì]` | security-reviewer → checklist review + findings file |
  | `/fix [findings]` | gantt-core-engineer → áp dụng finding Blocking |
  | `/feature <ý tưởng>` | pipeline đầy đủ plan → spec → build → test → review → fix |
- Rõ ràng: bảo "dùng **security-reviewer** subagent để review thay đổi CSV importer".
- Tự động: Claude Code có thể tự delegate dựa trên `description` của mỗi agent.

Mỗi subagent khởi động mới (không chia sẻ bộ nhớ) và nạp context bằng cách đọc `CLAUDE.md`
+ các rule liên quan trong `.claude/rules/`. Giữ những file đó luôn cập nhật.

> Các agent **cố ý không** commit/tag/push. Release là bước người dùng làm ở main session
> (changeset → version → changelog tự động).
