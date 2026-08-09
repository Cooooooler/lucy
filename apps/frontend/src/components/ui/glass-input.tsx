import { cn } from '@/components/lib/utils.ts';
import * as React from 'react';

export interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  glowOnFocus?: boolean;
}

const GlassInput = ({
  ref,
  className,
  type,
  glowOnFocus = true,
  ...props
}: GlassInputProps & { ref?: React.Ref<HTMLInputElement> }) => {
  return (
    <div className="group relative">
      {glowOnFocus && (
        <div className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-cyan-500/0 via-blue-500/0 to-purple-500/0 opacity-0 blur-md transition-all duration-300 group-focus-within:from-cyan-500/30 group-focus-within:via-blue-500/30 group-focus-within:to-purple-500/30 group-focus-within:opacity-70" />
      )}
      <input
        type={type}
        className={cn(
          'relative flex h-10 w-full rounded-xl px-4 py-2 text-sm',
          'border border-white/20 bg-white/10 backdrop-blur-xl',
          'placeholder:text-white/40',
          'shadow-[0_4px_16px_rgba(0,0,0,0.2)]',
          'transition-all duration-300',
          'focus:border-white/40 focus:bg-white/15 focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-white',
          className,
        )}
        ref={ref}
        {...props}
      />
    </div>
  );
};
GlassInput.displayName = 'GlassInput';

export { GlassInput };
