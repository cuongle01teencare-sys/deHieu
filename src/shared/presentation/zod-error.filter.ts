import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Lỗi validate input (Schema.parse trong controller) → 400 kèm danh sách lỗi theo trường,
 * thay vì 500 "Internal server error" + stack trace trong log.
 */
@Catch(ZodError)
export class ZodErrorFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();
    res.status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Dữ liệu gửi lên không hợp lệ',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
}
