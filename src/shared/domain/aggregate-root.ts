import type { DomainEvent } from './domain-event.js';

// ===== Props =====

export interface AggregateRootProps {
  readonly id: string;
}

export interface VersioningAggregateRootProps extends AggregateRootProps {
  readonly version: number;
}

export interface TimestampedAggregateRootProps extends AggregateRootProps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface VersioningTimestampedAggregateRootProps
  extends VersioningAggregateRootProps, TimestampedAggregateRootProps {}

// ===== Roots =====

export abstract class AggregateRoot<TProps extends AggregateRootProps> {
  private events: DomainEvent[] = [];

  protected constructor(public readonly props: TProps) {}

  protected addEvent(event: DomainEvent): void {
    this.events.push(event);
  }

  pullEvents(): DomainEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  toSnapShot(): Readonly<TProps> {
    return { ...this.props };
  }
}

export abstract class VersioningAggregateRoot<
  TProps extends VersioningAggregateRootProps,
> extends AggregateRoot<TProps> {}

export abstract class TimestampedAggregateRoot<
  TProps extends TimestampedAggregateRootProps,
> extends AggregateRoot<TProps> {}

export abstract class VersioningTimestampedAggregateRoot<
  TProps extends VersioningTimestampedAggregateRootProps,
> extends AggregateRoot<TProps> {}

// ===== Helper types =====

/** Các field do hệ thống tự gán, không truyền vào khi tạo mới */
export type AggregateRootDefaultKeys = 'version' | 'createdAt' | 'updatedAt';

export type AggregateRootNonDefaultProps<TProps extends AggregateRootProps> =
  Omit<TProps, AggregateRootDefaultKeys>;

/** Các field nghiệp vụ: bỏ id và mọi field kỹ thuật */
export type AggregateRootBusinessKeys<TProps extends AggregateRootProps> =
  Exclude<keyof TProps, keyof VersioningTimestampedAggregateRootProps>;
