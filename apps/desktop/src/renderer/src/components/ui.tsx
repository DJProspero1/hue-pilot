import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Throttle a callback (leading + trailing). Used for sliders talking to the bridge. */
export function useThrottle<T extends unknown[]>(fn: (...args: T) => void, ms = 120) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(
    (...args: T) => {
      const now = Date.now();
      const run = () => {
        last.current = Date.now();
        fnRef.current(...args);
      };
      if (now - last.current >= ms) {
        run();
      } else {
        pending.current = args;
        if (!timer.current) {
          timer.current = setTimeout(() => {
            timer.current = null;
            if (pending.current) {
              const a = pending.current;
              pending.current = null;
              last.current = Date.now();
              fnRef.current(...a);
            }
          }, ms - (now - last.current));
        }
      }
    },
    [ms],
  );
}

export function Toggle({ checked, onChange, size = 'md', disabled, label }: { checked: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; label?: string }) {
  const dims = size === 'sm' ? 'w-9 h-5' : size === 'lg' ? 'w-14 h-8' : 'w-11 h-6';
  const knob = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5';
  const shift = size === 'sm' ? 'translate-x-4' : size === 'lg' ? 'translate-x-6' : 'translate-x-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        dims,
        checked ? 'bg-gradient-to-r from-accent to-accent-2' : 'bg-slate-300 dark:bg-slate-600',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className={cx('inline-block rounded-full bg-white shadow transition-transform duration-200 translate-x-0.5', knob, checked && shift)} />
    </button>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  track,
  thick,
  disabled,
  className,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  track?: string;
  thick?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const pct = ((local - min) / (max - min)) * 100;
  const style = { '--track': track ?? `linear-gradient(90deg, rgba(255,170,80,0.9) 0%, rgba(255,210,140,0.95) ${pct}%, rgba(128,128,128,0.22) ${pct}%)` } as React.CSSProperties;
  return (
    <input
      type="range"
      aria-label={label}
      className={cx('slider', thick && 'thick', className)}
      style={style}
      min={min}
      max={max}
      step={step}
      value={local}
      disabled={disabled}
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={() => {
        dragging.current = false;
        onCommit?.(local);
      }}
      onKeyUp={() => onCommit?.(local)}
      onChange={(e) => {
        const v = Number(e.target.value);
        setLocal(v);
        onChange?.(v);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'subtle' | 'ghost' | 'danger' | 'outline'; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean };

export function Button({ variant = 'subtle', size = 'md', icon, loading, className, children, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 disabled:cursor-not-allowed select-none';
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' }[size];
  const variants = {
    primary: 'bg-gradient-to-r from-accent to-accent-2 text-white shadow-md hover:brightness-110 active:scale-[0.98]',
    subtle: 'surface-2 text-[var(--fg)] hover:brightness-110 active:scale-[0.98] border border-transparent hover:border-[var(--border-strong)]',
    ghost: 'bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-[var(--fg)]',
    outline: 'bg-transparent border border-[var(--border-strong)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--fg)]',
    danger: 'bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 border border-rose-500/30',
  }[variant];
  return (
    <button className={cx(base, sizes, variants, className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="spin" size={16} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ className, children, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-black/5 hover:text-[var(--fg)] dark:hover:bg-white/10 transition-colors disabled:opacity-40', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, onClick, glow }: { className?: string; children: ReactNode; onClick?: () => void; glow?: string }) {
  return (
    <div
      onClick={onClick}
      style={glow ? ({ '--glow': glow } as React.CSSProperties) : undefined}
      className={cx('surface rounded-2xl p-4 transition-all duration-200', onClick && 'cursor-pointer hover:border-[var(--border-strong)] hover:-translate-y-px', glow && 'glow-on', className)}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6 fade-in" onMouseDown={onClose}>
      <div className={cx('surface w-full rounded-2xl shadow-soft', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <IconButton onClick={onClose} title="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-5 pb-4 scroll max-h-[70vh]">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pb-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={cx('block', inline ? 'flex items-center justify-between gap-4 py-2' : 'mb-4')}>
      <span className="block">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
      <span className={cx('block', !inline && 'mt-1.5')}>{children}</span>
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('h-10 w-full rounded-xl surface px-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30 placeholder:text-muted', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('h-10 w-full rounded-xl surface px-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30', className)} {...rest}>
      {children}
    </select>
  );
}

export function Chip({ active, onClick, children, className, title, style }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; title?: string; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      title={title}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition-all whitespace-nowrap',
        active ? 'border-accent/70 bg-accent/15 text-[var(--fg)]' : 'border-[var(--border)] surface-2 hover:border-[var(--border-strong)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Swatch({ hex, on = true, size = 14, className, ring }: { hex: string; on?: boolean; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      className={cx('inline-block rounded-full shrink-0', ring && 'ring-2 ring-white/70 dark:ring-black/40', className)}
      style={{
        width: size,
        height: size,
        background: on ? hex : 'transparent',
        border: on ? '1px solid rgba(0,0,0,0.15)' : '2px solid rgba(128,128,128,0.45)',
        boxShadow: on ? `0 0 ${Math.max(6, size / 2)}px ${hex}88` : 'none',
      }}
    />
  );
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('spin text-muted', className)} />;
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 text-muted fade-in">
      {icon && <div className="mb-3 opacity-70">{icon}</div>}
      <div className="text-base font-medium text-[var(--fg)]">{title}</div>
      {hint && <div className="text-sm mt-1 max-w-md">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-[var(--border-strong)] surface-2 px-1.5 py-0.5 text-[10px] font-mono">{children}</kbd>;
}
