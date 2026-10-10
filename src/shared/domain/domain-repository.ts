export type OperationStatus<TObject> =
  | {
      // operation chạy thành công nhưng operation không trả về dữ liệu gì, có thể là find không thấy chẳng hạn
      status: 'SUCEED';
      data: TObject;
    }
  | { status: 'NOT_FOUND' }
  | {
      status: 'FAILED';
      reason: string;
    };

export interface DomainRepository<TObject> {
  findById(id: string): Promise<OperationStatus<TObject>>;
  save(obj: TObject): Promise<OperationStatus<TObject>>;
}
