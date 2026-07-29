---
description: Review bảo mật thay đổi hiện tại (hoặc $ARGUMENTS) bằng security-reviewer subagent — checklist XSS/parsing/AI/authZ của FluxGantt.
argument-hint: [cần review gì, vd "CSV importer" hoặc đường dẫn; trống = thay đổi hiện tại]
---
Dùng **security-reviewer** subagent để review $ARGUMENTS.

Nếu $ARGUMENTS trống, review thay đổi chưa commit (`git status` / `git diff`).

Theo `.claude/agents/security-reviewer.md` và checklist `.claude/rules/security.md`, soi theo
thứ tự rủi ro: XSS render (nội suy `task.name`/`notes`/`meta`/`color` vào SVG/DOM; whitelist
color; sanitize export), parsing untrusted (validate schema, XXE cho XML, DoS size/depth,
CSV formula injection, cycle throw), AI/prompt-injection, Cloud authZ (scope tenant + role
server-side, share token entropy + hash, API key hash, SQL param, webhook HMAC/SSRF, rate
limit), secret/dependency.

Mỗi phát hiện: mức độ + `file:line` + vì sao nguy hiểm + cách sửa. Phân biệt lỗ hổng thật vs
hardening; nếu an toàn thì nói rõ. Ghi findings đánh số vào `.claude/work/review-<slug>.md`.
Chỉ review, không tự sửa.
