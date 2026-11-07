import { QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Splash } from './components/Logo';
import { Button, ErrorState, Spinner, Toaster } from './components/ui';
import { requestPersistentStorage } from './core/db';
import { initDownloads } from './core/downloads';
import { startAutoSync } from './core/sync/cloud';
import { queryClient } from './lib/queries';
import { onBackButton } from './platform';
import { applyTheme, useSettings } from './stores/settings';

const Home = lazy(() => import('./features/home/HomePage'));
const Discover = lazy(() => import('./features/discover/DiscoverPage'));
const MetaDetails = lazy(() => import('./features/discover/MetaDetailsPage'));
const Library = lazy(() => import('./features/library/LibraryPage'));
const TitlePage = lazy(() => import('./features/library/TitlePage'));
const Reader = lazy(() => import('./features/reader/ReaderPage'));
const Updates = lazy(() => import('./features/updates/UpdatesPage'));
const HistoryPage = lazy(() => import('./features/history/HistoryPage'));
const Downloads = lazy(() => import('./features/downloads/DownloadsPage'));
const Assistant = lazy(() => import('./features/assistant/AssistantPage'));
const Extensions = lazy(() => import('./features/extensions/ExtensionsPage'));
const Settings = lazy(() => import('./features/settings/SettingsPage'));
const Account = lazy(() => import('./features/account/AccountPage'));
const SourceBrowse = lazy(() => import('./features/extensions/SourceBrowsePage'));

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }
  componentDidCatch(error: unknown) {
    console.error('[furina] render error', error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="grid min-h-screen place-items-center">
          <div>
            <ErrorState error={this.state.error} title="This screen crashed" onRetry={() => this.setState({ error: undefined })} />
            <div className="text-center">
              <Button variant="link" onClick={() => (location.hash = '#/')}>
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    return this.props.children;
  }
}

const PageFallback = () => (
  <div className="grid min-h-[50vh] place-items-center">
    <Spinner className="h-7 w-7" />
  </div>
);

function Effects() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    applyTheme(theme, accent, reduceMotion);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme(theme, accent, reduceMotion);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme, accent, reduceMotion]);

  useEffect(() => {
    void requestPersistentStorage();
    void initDownloads();
    return startAutoSync();
  }, []);

  // Android back button: go back unless at Home (then the OS exits the app).
  useEffect(() => {
    let off = () => {};
    void onBackButton(() => {
      if (document.querySelector('[role="dialog"]')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return true;
      }
      if (loc.pathname === '/') return false;
      nav(-1);
      return true;
    }).then((f) => (off = f));
    return () => off();
  }, [loc.pathname, nav]);

  useEffect(() => {
    if (!loc.pathname.startsWith('/read/')) window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return null;
}

function Routed() {
  const loc = useLocation();
  const isReader = loc.pathname.startsWith('/read/');
  const routes = (
    <Suspense fallback={isReader ? <Splash /> : <PageFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/discover/:id" element={<MetaDetails />} />
        <Route path="/library" element={<Library />} />
        <Route path="/title/:id" element={<TitlePage />} />
        <Route path="/read/:chapterId" element={<Reader />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/extensions" element={<Extensions />} />
        <Route path="/source/:sourceId" element={<SourceBrowse />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<ErrorState title="Page not found" error="That page doesn't exist." onRetry={() => (location.hash = '#/')} />} />
      </Routes>
    </Suspense>
  );
  return (
    <>
      <Effects />
      <ErrorBoundary resetKey={loc.pathname}>{isReader ? routes : <Shell>{routes}</Shell>}</ErrorBoundary>
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routed />
      </HashRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
