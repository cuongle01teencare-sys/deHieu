/** Chờ ms, kết thúc sớm (không ném lỗi) khi signal abort. */
export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} ${url}`);
  }
}

/** GET JSON, huỷ được bằng signal. Không parse nghiệp vụ — trả nguyên dữ liệu thô. */
export const getJson = async (
  url: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<unknown> => {
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new HttpStatusError(res.status, url);
  return (await res.json()) as unknown;
};
