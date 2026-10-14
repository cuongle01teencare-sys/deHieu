import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const DESCRIPTION = `
API của hệ thống ghép kèo arbitrage. Tài liệu sinh từ code (route, quyền, schema zod) nên luôn khớp với bản đang chạy.

### Xác thực và phân quyền
Mọi endpoint cần header \`Authorization: Bearer <token>\` (bấm **Authorize** ở trên để nhập).
Endpoint chỉ yêu cầu **quyền** (vd \`tasks:manage\`), vai trò nào có quyền nào là cấu hình (\`API_TOKENS\`, \`ROLE_PERMISSIONS\`).
Vai trò mặc định: \`admin\` (\`*\`), \`manager\`, \`staff\`, \`viewer\` (\`*:read\`). \`401\` = thiếu/sai token, \`403\` = thiếu quyền.
Quyền của từng endpoint nằm trong mô tả và trong trường \`x-required-permissions\`.

### Kênh dữ liệu
Mỗi tenant có 3 khái niệm: **descriptor** (metadata), **live**, **prematch**. Mỗi \`kind\` chỉ chạy một instance.
Kèo có chân nào live thì \`phase = live\`. Bật/tắt kênh tạo kèo bằng \`PATCH /arbitrage/settings { enabledPhases }\`.

### WebSocket cho consumer (bot giao dịch, Discord) — cổng \`CONSUMER_WS_PORT\`
\`\`\`
consumer → { type:"hello", v:1, consumerId, role:"trader"|"discord"|"other", token }
app      → { type:"welcome", paused }                 (+ gửi lại các kèo còn hiệu lực)
app      → { type:"signal", deliveryId, kind:"issued"|"refreshed", signal, supersedes? }
app      → { type:"cancel", deliveryId, signalId, room, comboId, reason }
consumer → { type:"ack", deliveryId }                 (chưa ack → gửi lại mỗi 2s)
app      → { type:"control", action:"pause"|"resume" }
hai chiều: { type:"heartbeat", at }
\`\`\`
Lý do hủy: \`below_threshold\`, \`better_opportunity\`, \`margin_decreased\`, \`leg_suspended\`, \`leg_removed\`, \`start_time_mismatch\`, \`publisher_stopped\`, \`phase_disabled\`, \`match_expired\`, \`missing_from_listing\`.
Tăng đủ \`marginStep\` hoặc giảm đủ \`marginDropStep\` so với lần phát mới gần nhất → hủy kèo cũ rồi phát kèo mới. Hai bước mặc định 1 điểm phần trăm, cấu hình riêng và lưu bền bằng \`PATCH /arbitrage/settings\`.
\`signal.legs[i].ref\` là ID gốc để đặt lệnh — sptpub: \`e\`, \`m\`, \`s\`, \`o0\`/\`o1\`; polymarket: \`c\`, \`slug\`, \`t0\`/\`t1\`.
`;

/** Gắn Swagger UI vào app: UI tại `/{path}`, JSON tại `/{path}-json`. */
export const setupOpenApi = (app: INestApplication, path = 'docs'): void => {
  const config = new DocumentBuilder()
    .setTitle('nest-de-hieu-v2 API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      description: 'Token trong API_TOKENS',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(path, app, document, {
    jsonDocumentUrl: `${path}-json`,
    swaggerOptions: { persistAuthorization: true },
  });
};
