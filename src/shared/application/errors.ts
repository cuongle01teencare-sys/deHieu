export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} không tồn tại.`);
    this.name = 'NotFoundError';
  }
}

export class ConcurrencyError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} đã bị thay đổi bởi request khác.`);
    this.name = 'ConcurrencyError';
  }
}
