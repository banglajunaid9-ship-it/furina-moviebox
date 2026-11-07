import { cn } from './ui';

/** Furina Reader mark: a water droplet cradling an open book. Original artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id="fr-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--accent))" />
          <stop offset="1" stopColor="rgb(var(--accent-2))" />
        </linearGradient>
      </defs>
      <path d="M32 6S13 27 13 40a19 19 0 0 0 38 0C51 27 32 6 32 6Z" fill="url(#fr-g)" />
      <path d="M21.5 38.5c3.6-1.8 7.3-1.8 10.5 1 3.2-2.8 6.9-2.8 10.5-1v11c-3.6-1.8-7.3-1.8-10.5 1-3.2-2.8-6.9-2.8-10.5-1Z" fill="rgb(var(--bg))" opacity=".9" />
      <path d="M32 39.5v11" stroke="url(#fr-g)" strokeWidth="1.3" />
      <circle cx="24.5" cy="27" r="2.4" fill="#fff" opacity=".55" />
    </svg>
  );
}

export function Wordmark({ collapsed }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9 drop-shadow-[0_4px_16px_rgb(var(--accent)/.45)]" />
      {!collapsed && (
        <span className="leading-none">
          <span className="block font-display text-[19px] font-semibold tracking-tight">Furina</span>
          <span className="block text-[10px] font-bold uppercase tracking-[0.28em] text-muted">Reader</span>
        </span>
      )}
    </span>
  );
}

export function Splash() {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-5 animate-rise">
        <LogoMark className="h-16 w-16 animate-pulse" />
        <p className="font-display text-sm tracking-wide text-muted">Your world. Your stories. Your library.</p>
      </div>
    </div>
  );
}
