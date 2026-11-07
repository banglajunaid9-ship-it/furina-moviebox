/* Design-system primitives (shadcn/ui-style: unstyled-logic + Tailwind tokens). */
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';
import { create } from 'zustand';

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/* --------------------------------- Button --------------------------------- */

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'accent-gradient text-on-accent shadow-glow hover:brightness-110',
        secondary: 'border bg-raised/70 text-ink hairline hover:bg-raised',
        ghost: 'text-muted hover:bg-raised/70 hover:text-ink',
        danger: 'bg-danger/15 text-danger hover:bg-danger/25',
        link: 'px-0 text-accent underline-offset-4 hover:underline',
      },
      size: { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base', icon: 'h-10 w-10', iconSm: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

/* --------------------------------- Inputs --------------------------------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn('field', className)} {...p} />
));
Input.displayName = 'Input';

export function Field({ label, hint, children, error }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'accent-gradient' : 'bg-raised border hairline')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border bg-surface p-1 hairline">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-lg font-semibold transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.id ? 'bg-accent/20 text-ink shadow-[inset_0_0_0_1px_rgb(var(--accent)/.4)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Surfaces ------------------------------- */

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border bg-surface/80 shadow-card hairline', className)} {...p} />;
}

export function Badge({ className, tone = 'default', ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'accent' | 'success' | 'warn' | 'danger' }) {
  const tones = {
    default: 'bg-raised text-muted',
    accent: 'bg-accent/15 text-accent',
    success: 'bg-success/15 text-success',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', tones[tone], className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-accent', className)} aria-label="Loading" />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center animate-rise">
      <div className="relative mb-5 grid h-20 w-20 place-items-center">
        <span className="absolute inset-0 rounded-full bg-accent/20 animate-ripple" />
        <span className="relative grid h-16 w-16 place-items-center rounded-2xl border bg-surface text-accent hairline">{icon}</span>
      </div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {body && <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger/15 text-danger">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{msg}</p>
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* --------------------------------- Dialog --------------------------------- */

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])')?.focus(), 20);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('glass flex max-h-[92vh] w-full flex-col rounded-t-2xl animate-rise sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-center justify-between border-b px-5 py-4 hairline">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <Button data-close variant="ghost" size="iconSm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3 hairline safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- Toasts --------------------------------- */

interface Toast {
  id: number;
  text: string;
  tone: 'default' | 'success' | 'danger';
}
const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ list: [...s.list.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ list: s.list.filter((x) => x.id !== id) })), 4200);
  },
  drop: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}));

export const toast = (text: string, tone: Toast['tone'] = 'default') => useToasts.getState().push({ text, tone });
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'danger');

export function Toaster() {
  const list = useToasts((s) => s.list);
  const drop = useToasts((s) => s.drop);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {list.map((t) => (
        <button
          key={t.id}
          onClick={() => drop(t.id)}
          className={cn(
            'glass pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-left text-sm font-medium shadow-card animate-rise',
            t.tone === 'success' && 'text-success',
            t.tone === 'danger' && 'text-danger',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
