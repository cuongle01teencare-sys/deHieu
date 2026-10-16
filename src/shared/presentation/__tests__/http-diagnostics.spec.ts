import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpDiagnostics } from '../http-diagnostics.js';

afterEach(() => vi.restoreAllMocks());

function setup(logSuccess = false) {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const req = {
    method: 'POST',
    route: { path: '/example/:id' },
    originalUrl: '/example/private-id?token=private-query',
    headers: { authorization: 'Bearer private-header' },
    body: { password: 'private-password' },
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
    setHeader: vi.fn(),
  });
  const next = vi.fn();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  httpDiagnostics({ logger, logSuccess })(
    req,
    res as unknown as Response,
    next,
  );
  return { logger, req, res, next, clock };
}

describe('HTTP diagnostics', () => {
  it('logs a safe summary for failed requests and returns a server request ID', () => {
    const { logger, res, next, clock } = setup();
    res.statusCode = 500;
    res.writableFinished = true;
    clock.mockReturnValue(125);
    res.emit('finish');
    res.emit('close');
    expect(next).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    const message = logger.error.mock.calls[0][0] as string;
    expect(message).toContain('POST /example/:id → HTTP 500 | 125 ms');
    expect(message).toContain('chưa chứa nguyên nhân bên trong');
    const requestId = res.setHeader.mock.calls[0][1] as string;
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
    expect(requestId).toMatch(/^[\da-f-]{36}$/);
    expect(message).toContain(`Mã yêu cầu: ${requestId}`);
    expect(message).not.toMatch(/private-|password|authorization|Bearer/);
  });

  it('leaves fast successful requests quiet by default', () => {
    const { logger, res } = setup();
    res.emit('finish');
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs slow responses and HTTP client errors as warnings', () => {
    const { logger, res, clock } = setup();
    clock.mockReturnValue(1000);
    res.emit('finish');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain('Phản hồi chậm');
    const second = setup();
    second.res.statusCode = 403;
    second.res.emit('finish');
    expect(second.logger.warn).toHaveBeenCalledOnce();
  });

  it('logs successful requests when explicitly enabled', () => {
    const { logger, res } = setup(true);
    res.emit('finish');
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.log.mock.calls[0][0]).toContain(
      'Mã HTTP không xác nhận kết quả tác vụ nền',
    );
  });

  it('makes clear that HTTP 202 only accepts a task for processing', () => {
    const { logger, res } = setup(true);
    res.statusCode = 202;
    res.emit('finish');
    expect(logger.log.mock.calls[0][0]).toContain(
      'tác vụ có thể vẫn đang chạy',
    );
  });

  it('records a disconnected client once without changing the actual response status', () => {
    const { logger, res, req } = setup();
    req.route = undefined;
    res.emit('close');
    res.emit('finish');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain('KẾT NỐI BỊ NGẮT');
    expect(logger.warn.mock.calls[0][0]).toContain('<không có route khớp>');
    expect(res.statusCode).toBe(200);
  });
});
