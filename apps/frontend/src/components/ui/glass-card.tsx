import { cn } from '@/components/lib/utils.ts';
import * as React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glowEffect?: boolean;
  children: React.ReactNode;
}

const GlassCard = ({
  ref,
  className,
  glowEffect = true,
  children,
  ...props
}: GlassCardProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  return (
    <div className={cn('relative', className)}>
      {glowEffect && (
        <div className="absolute -inset-1 rounded-2xl bg-linear-to-r from-cyan-500/30 via-blue-500/30 to-purple-500/30 opacity-70 blur-xl" />
      )}
      <div
        ref={ref}
        className={cn(
          'relative rounded-2xl border border-white/20',
          'bg-white/10 backdrop-blur-xl',
          'shadow-[0_8px_32px_rgba(0,0,0,0.37)]',
          'before:absolute before:inset-0 before:rounded-2xl',
          'before:pointer-events-none before:bg-linear-to-b before:from-white/20 before:to-transparent',
          'after:absolute after:inset-px after:rounded-[calc(1rem-1px)]',
          'after:pointer-events-none after:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]',
        )}
        {...props}
      >
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
};
GlassCard.displayName = 'GlassCard';

const GlassCardHeader = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement | null>;
}) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1.5 p-6', className)}
    {...props}
  />
);
GlassCardHeader.displayName = 'GlassCardHeader';

const GlassCardTitle = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  ref?: React.RefObject<HTMLHeadingElement | null>;
}) => (
  <h3
    ref={ref}
    className={cn(
      'text-xl leading-none font-semibold tracking-tight text-white',
      className,
    )}
    {...props}
  />
);
GlassCardTitle.displayName = 'GlassCardTitle';

const GlassCardDescription = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.RefObject<HTMLParagraphElement | null>;
}) => (
  <p ref={ref} className={cn('text-sm text-white/60', className)} {...props} />
);
GlassCardDescription.displayName = 'GlassCardDescription';

const GlassCardContent = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement | null>;
}) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
GlassCardContent.displayName = 'GlassCardContent';

const GlassCardFooter = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement | null>;
}) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
);
GlassCardFooter.displayName = 'GlassCardFooter';

export {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
};
