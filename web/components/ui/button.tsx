'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from './tooltip';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] font-medium transition-[background-color,color,box-shadow,opacity] duration-150 ease-out disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:brightness-110 disabled:hover:brightness-100',
        secondary: 'bg-hover text-fg hover:bg-line-strong',
        ghost: 'text-muted-fg hover:bg-hover hover:text-fg',
        outline: 'text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover',
        danger: 'bg-critical text-white hover:brightness-110',
        'danger-ghost': 'text-critical hover:bg-critical-soft',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-caption',
        md: 'h-8 px-3 text-body',
        lg: 'h-10 px-4 text-[14px]',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Khi có: nút bị khóa và hiện lý do (vd thiếu quyền `tasks:manage`, đang offline). */
  disabledReason?: string | null;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabledReason, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  const btn = (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading || !!disabledReason}
      aria-disabled={!!disabledReason || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Comp>
  );
  if (!disabledReason) return btn;
  // nút disabled không nhận sự kiện chuột → bọc span để tooltip vẫn hiện
  return (
    <Hint content={disabledReason}>
      <span tabIndex={0} className="inline-flex">
        {btn}
      </span>
    </Hint>
  );
});
