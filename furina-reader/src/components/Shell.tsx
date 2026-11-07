import {
  Bot,
  Compass,
  Download,
  History,
  Home,
  LibraryBig,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Settings,
  Sparkles,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSettings } from '@/stores/settings';
import { useOnline } from '@/lib/hooks';
import { Wordmark } from './Logo';
import { cn, Dialog } from './ui';
import { ImportDropZone } from './ImportButton';

export const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/library', label: 'Library', icon: LibraryBig },
  { to: '/updates', label: 'Updates', icon: Sparkles },
  { to: '/history', label: 'History', icon: History },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/assistant', label: 'AI Assistant', icon: Bot },
  { to: '/extensions', label: 'Extensions', icon: Puzzle },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/account', label: 'Account', icon: UserRound },
] as const;

const MOBILE_PRIMARY = ['/', '/discover', '/library', '/updates'];

function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  return (
    <aside
      className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-surface/40 backdrop-blur-xl hairline transition-[width] duration-300 md:flex', collapsed ? 'w-[76px]' : 'w-64')}
      aria-label="Main navigation"
    >
      <div className={cn('flex h-16 items-center', collapsed ? 'justify-center' : 'px-5')}>
        <Wordmark collapsed={collapsed} />
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map((n, i) => (
          <div key={n.to}>
            {(i === 4 || i === 8) && <div className="mx-3 my-2 border-t hairline" />}
            <NavLink
              to={n.to}
              end={'end' in n}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-10 items-center gap-3 rounded-xl text-sm font-semibold transition',
                  collapsed ? 'justify-center' : 'px-3',
                  isActive ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full accent-gradient" />}
                  <n.icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-accent')} />
                  {!collapsed && <span>{n.label}</span>}
                </>
              )}
            </NavLink>
          </div>
        ))}
      </nav>
      <button
        onClick={() => set({ sidebarCollapsed: !collapsed })}
        className={cn('m-3 flex h-10 items-center gap-3 rounded-xl text-sm text-muted transition hover:bg-raised/60 hover:text-ink', collapsed ? 'justify-center' : 'px-3')}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  );
}

function BottomNav() {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const primary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.to));
  const rest = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to));
  const moreActive = rest.some((n) => loc.pathname.startsWith(n.to));
  return (
    <>
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 safe-bottom md:hidden" aria-label="Main navigation">
        <div className="grid grid-cols-5">
          {primary.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n}
              className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-accent' : 'text-muted')}
            >
              <n.icon className="h-5 w-5" />
              {n.label}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', moreActive ? 'text-accent' : 'text-muted')}>
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-3 gap-2 pb-2">
          {rest.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => cn('flex flex-col items-center gap-2 rounded-2xl border p-4 text-xs font-semibold hairline', isActive ? 'bg-accent/15 text-ink' : 'bg-surface text-muted')}
            >
              <n.icon className="h-6 w-6 text-accent" />
              {n.label}
            </NavLink>
          ))}
        </div>
      </Dialog>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const online = useOnline();
  return (
    <ImportDropZone>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          {!online && (
            <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-warn/15 px-4 py-1.5 text-xs font-semibold text-warn backdrop-blur safe-top">
              <WifiOff className="h-3.5 w-3.5" /> You're offline — your library and downloads still work.
            </div>
          )}
          <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 md:pb-12 md:pt-8 lg:px-10 safe-top">
            {children}
          </main>
        </div>
        <BottomNav />
      </div>
    </ImportDropZone>
  );
}
