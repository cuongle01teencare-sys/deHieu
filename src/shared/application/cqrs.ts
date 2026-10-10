/**
 * Command/Query handler thuần — không phụ thuộc thư viện CQRS nào.
 * Controller (presentation) gọi thẳng handler.execute(...).
 */
export interface CommandHandler<TCommand, TResult = void> {
  execute(command: TCommand): Promise<TResult>;
}

export interface QueryHandler<TQuery, TResult> {
  execute(query: TQuery): Promise<TResult>;
}
