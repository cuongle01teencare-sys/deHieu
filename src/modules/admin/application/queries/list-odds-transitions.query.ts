import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { OddsTransition } from '../../domain/odds-transition.js';
import type {
  OddsTransitionQuery,
  OddsTransitionRepository,
} from '../odds-transition.repository.js';

export class ListOddsTransitionsHandler implements QueryHandler<
  OddsTransitionQuery,
  OddsTransition[]
> {
  constructor(private readonly _repo: OddsTransitionRepository) {}

  execute(q: OddsTransitionQuery) {
    return this._repo.list(q);
  }
}
