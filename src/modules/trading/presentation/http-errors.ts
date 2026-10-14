import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { OperationStatus } from '../../../shared/domain/domain-repository.js';

/** OperationStatus → HTTP: NOT_FOUND → 404, FAILED → 400. */
export const unwrap = <T>(r: OperationStatus<T>): T => {
  if (r.status === 'SUCEED') return r.data;
  if (r.status === 'NOT_FOUND') throw new NotFoundException();
  throw new BadRequestException(r.reason);
};
