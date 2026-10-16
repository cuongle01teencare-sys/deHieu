import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';

type DiagnosticLogger = Pick<Logger, 'log' | 'warn' | 'error'>;
const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

function explainStatus(status: number): string {
  if (status === 202)
    return 'Backend đã tiếp nhận yêu cầu; tác vụ có thể vẫn đang chạy.';
  if (status >= 200 && status < 300)
    return 'Backend đã trả phản hồi. Mã HTTP không xác nhận kết quả tác vụ nền; kết quả đó nằm trong dữ liệu trả về.';
  if (status >= 300 && status < 400)
    return 'Backend yêu cầu chuyển hướng hoặc sử dụng bản dữ liệu đã lưu.';
  if (status === 400 || status === 422)
    return 'Backend từ chối dữ liệu gửi lên vì yêu cầu không hợp lệ.';
  if (status === 401) return 'Yêu cầu chưa được xác thực với backend.';
  if (status === 403) return 'Backend không cho phép thực hiện yêu cầu này.';
  if (status === 404) return 'Backend không tìm thấy đường dẫn hoặc dữ liệu.';
  if (status === 409)
    return 'Yêu cầu xung đột với trạng thái dữ liệu hiện tại.';
  if (status === 429) return 'Yêu cầu bị giới hạn vì gửi quá nhiều lần.';
  if (status >= 500)
    return 'Backend hoặc dịch vụ phụ thuộc gặp lỗi. Log HTTP này chưa chứa nguyên nhân bên trong.';
  return 'Backend đã trả phản hồi; cần xem dữ liệu trả về để biết chi tiết.';
}

/** Log metadata only: never request URLs, payloads, headers, or error messages. */
export function httpDiagnostics(
  options: { logSuccess?: boolean; logger?: DiagnosticLogger } = {},
): RequestHandler {
  const logger = options.logger ?? new Logger('HttpDiagnostics');
  return (req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader('X-Request-Id', requestId);
    const complete = (aborted: boolean) => {
      res.off('finish', onFinish);
      res.off('close', onClose);
      const durationMs = Math.round(performance.now() - started);
      const status = aborted ? 499 : res.statusCode;
      if (!options.logSuccess && !aborted && status < 400 && durationMs < 1000)
        return;
      // Express supplies the registered template, so account IDs and query
      // parameters from the actual URL cannot enter the log.
      const route = req.route as { path?: unknown } | undefined;
      const method = METHODS.has(req.method) ? req.method : 'OTHER';
      const routeName =
        typeof route?.path === 'string'
          ? JSON.stringify(route.path).slice(1, -1)
          : '<không có route khớp>';
      const message = [
        `${method} ${routeName} → ${aborted ? 'KẾT NỐI BỊ NGẮT' : `HTTP ${status}`} | ${durationMs} ms`,
        aborted
          ? '  Kết quả: Máy khách đã ngắt kết nối trước khi backend gửi xong phản hồi. Mã 499 chỉ dùng trong log.'
          : `  Kết quả HTTP: ${explainStatus(status)}`,
        ...(!aborted && durationMs >= 1000
          ? ['  Thời gian: Phản hồi chậm (từ 1 giây trở lên).']
          : []),
        `  Mã yêu cầu: ${requestId}`,
      ].join('\n');
      if (status >= 500) logger.error(message);
      else if (status >= 400 || durationMs >= 1000) logger.warn(message);
      else logger.log(message);
    };
    const onFinish = () => complete(false);
    const onClose = () => complete(!res.writableFinished);
    res.once('finish', onFinish);
    res.once('close', onClose);
    next();
  };
}
