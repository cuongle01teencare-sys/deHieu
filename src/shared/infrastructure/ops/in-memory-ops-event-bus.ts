import type {
  OpsEvent,
  OpsEventBus,
  OpsListener,
} from '../../application/ops-event-bus.js';

/**
 * Bus trong tiến trình, đồng bộ. Listener lỗi bị cô lập để không làm hỏng
 * luồng nghiệp vụ đã phát sự kiện (ingest odds, vòng đời task...).
 */
export class InMemoryOpsEventBus implements OpsEventBus {
  private readonly _listeners = new Set<OpsListener>();

  constructor(
    private readonly _onListenerError: (e: unknown) => void = () => undefined,
  ) {}

  publish(event: OpsEvent): void {
    for (const l of this._listeners) {
      try {
        l(event);
      } catch (e: unknown) {
        this._onListenerError(e);
      }
    }
  }

  subscribe(listener: OpsListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}
