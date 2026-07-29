# .claude/work — artifact bàn giao giữa subagent

Thư mục làm việc (gitignored) cho pipeline subagent. Mỗi bước ghi một file để bước sau đọc,
thay vì suy lại diff từ đầu:

- `plan-<slug>.md` — planner: quyết định tier + phạm vi v1.
- `spec-<slug>.md` — spec-writer: design (API, type, layer, thuật toán, test plan).
- `review-<slug>.md` — security-reviewer: findings đánh số Blocking/non-blocking cho `/fix`.

Nội dung ở đây **không commit** (chỉ file README này được track). Xem `.claude/agents/README.md`
cho quy trình đầy đủ.
