# Rule: Security (BẮT BUỘC đọc trước khi đụng IO / Auth / Cloud / AI)

FluxGantt render dữ liệu do **người khác cung cấp** (task của host app, file import, share link). Mọi input ngoài là **untrusted**.

## 1. Rendering & XSS (Core — quan trọng nhất vì là library nhúng)
- **SVG renderer**: KHÔNG bao giờ nội suy chuỗi người dùng vào markup. Dùng `textContent` / `createElementNS` + `setAttribute`, không `innerHTML`/template string cho `task.name`, `notes`, `meta`, `color`.
- `task.color` và mọi giá trị đổ vào style/attribute phải **validate whitelist** (hex/CSS color hợp lệ), không cho `url(...)`, `expression`, `javascript:`.
- Export SVG/PNG/PDF: sanitize trước khi serialize — SVG xuất ra có thể bị mở như HTML.
- `meta: Record<string, unknown>` là field tự do của user → coi như untrusted khi hiển thị.
- Tôn trọng CSP của host app: không inline script, không `eval`, không `new Function`.

## 2. Import / Parsing (IO layer)
- **JSON/CSV/MS Project XML** = untrusted. Validate schema trước khi nạp vào store (vd zod hoặc validator thủ công). Reject thay vì "best-effort" với dữ liệu sai.
- **XML (MS Project)**: parser phải **disable external entity / DTD** → chống XXE. Không resolve entity ngoài, không network fetch khi parse. Giới hạn kích thước & độ sâu (chống billion-laughs / entity expansion DoS).
- CSV: chống **formula injection** — escape cell bắt đầu bằng `= + - @ tab/CR` khi export ra file mở bằng Excel.
- Giới hạn: số task, độ sâu hierarchy, độ dài chuỗi → tránh DoS qua file độc.
- Cycle trong dependency phải bị phát hiện và throw, không loop vô hạn (CPM).

## 3. AI layer (Pro/Cloud) — prompt injection
- Natural-language input của user đi vào LLM = **untrusted**. Đừng nối thẳng vào system prompt; tách rõ system vs user content.
- Output LLM (task/dep JSON) phải **validate lại bằng schema** trước khi dùng — không tin cấu trúc trả về.
- AI là **"suggest" không "decide"**: luôn cho user review + revert. Không tự ghi đè plan.
- Không gửi dữ liệu nhạy cảm của project ra LLM nếu chưa có sự đồng ý / theo tier. Log/redact PII.

## 4. Cloud backend (Wave 3)
- **AuthZ multi-tenant**: mọi query scope theo `org_id` / `project_id`. Kiểm `membership.role` (owner/admin/editor/viewer) ở **server**, không tin client. IDOR là rủi ro số 1.
- **Auth**: Better-Auth. Password/secret không log. Session cookie `HttpOnly`, `Secure`, `SameSite`.
- **Share link**: `token` ngẫu nhiên ≥ 32 byte entropy (lưu unique). `password_hash` dùng **argon2/bcrypt** (cột `password_hash` trong schema — không lưu plaintext). Tôn trọng `expires_at`, `permission` (read/comment/edit), tăng `view_count` an toàn.
- **API keys**: chỉ lưu `key_hash` (hash, không plaintext) + `prefix` để nhận diện. Hỗ trợ `scopes` + `revoked_at`. Hiển thị key đầy đủ đúng 1 lần lúc tạo.
- **SQL**: dùng Drizzle param hoá, không string-concat query. JSONB (`meta`, `settings`, `snapshot`) vẫn validate trước khi lưu.
- **Webhooks**: ký payload (HMAC), verify chữ ký phía nhận. Chống SSRF khi gọi URL do user nhập (chặn IP nội bộ, metadata endpoint).
- **Rate limiting** trên API + AI endpoint (chi phí per-call). Hard limit theo tier.
- **Multiplayer (Yjs)**: authZ trước khi join room; không tin update CRDT từ client chưa xác thực.

## 5. Quản lý secret & dependency
- Không hardcode secret (Stripe, Resend, DB URL, R2, LLM key). Dùng env, không commit `.env`.
- Stripe webhook: verify signature. Không tin giá/tier từ client.
- Tối thiểu hoá dependency (cũng giúp bundle nhỏ). Audit định kỳ (`pnpm audit`), pin version, dùng lockfile.
- License key (Pro): validate có chữ ký, không để client tự bypass; nhưng đừng "phone home" xâm phạm privacy.

## 6. Privacy (GDPR — Cloud/Enterprise)
- Privacy-by-design. Cho phép export & xoá dữ liệu user. Data residency option cho Enterprise. Template DPA sẵn sàng.
- Analytics dùng Plausible (privacy-first), không track PII thừa.

## Checklist nhanh khi viết code đụng input ngoài
- [ ] Input đã validate schema chưa?
- [ ] Có nội suy chuỗi user vào DOM/SVG/SQL/prompt không? → sửa.
- [ ] XML đã tắt external entity chưa?
- [ ] Query đã scope theo tenant + check role chưa?
- [ ] Secret có lọt vào log/commit/client không?
- [ ] Có giới hạn kích thước/độ sâu/rate để chống DoS chưa?
