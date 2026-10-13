import type { Page } from '../../../../shared/application/page.js';
import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { OddsTransition } from '../../domain/odds-transition.js';
import type {
  OddsTransitionQuery,
  OddsTransitionRepository,
} from '../odds-transition.repository.js';

export class ListOddsTransitionsHandler implements QueryHandler<
  OddsTransitionQuery,
  Page<OddsTransition>
> {
  constructor(private readonly _repo: OddsTransitionRepository) {}

  async execute(q: OddsTransitionQuery): Promise<Page<OddsTransition>> {
    const [items, total] = await Promise.all([
      this._repo.list(q),
      this._repo.count(q),
    ]);
    return { total, items };
  }
}
