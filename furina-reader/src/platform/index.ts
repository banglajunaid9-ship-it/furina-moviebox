/**
 * Thin platform adapter. Shared code calls these helpers; platform-specific
 * plugins are imported lazily so the web bundle never loads native code paths.
 */
type W = { __TAURI_INTERNALS__?: unknown; Capacitor?: { isNativePlatform(): boolean; getPlatform(): string } };
const w = (typeof window !== 'undefined' ? window : {}) as W;

export const isTauri = !!w.__TAURI_INTERNALS__;
export const isNativeAndroid = !!w.Capacitor?.isNativePlatform?.() && w.Capacitor?.getPlatform() === 'android';
export const platform: 'windows' | 'android' | 'web' = isTauri ? 'windows' : isNativeAndroid ? 'android' : 'web';

export async function setFullscreen(on: boolean) {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (isNativeAndroid) {
    const { StatusBar } = await import('@capacitor/status-bar');
    await (on ? StatusBar.hide() : StatusBar.show()).catch(() => {});
    return;
  }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* user gesture required or unsupported */
  }
}

export async function isFullscreen(): Promise<boolean> {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().isFullscreen();
  }
  return !!document.fullscreenElement;
}

export type OrientationPref = 'auto' | 'portrait' | 'landscape';
export async function lockOrientation(o: OrientationPref) {
  try {
    if (isNativeAndroid) {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      if (o === 'auto') await ScreenOrientation.unlock();
      else await ScreenOrientation.lock({ orientation: o });
      return;
    }
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o === 'auto') so.unlock?.();
    else await so.lock?.(o);
  } catch {
    /* not supported on this device/browser */
  }
}

/** Keep the screen awake while reading (Wake Lock API, supported on Android Chrome, Edge, WebView2). */
export async function keepAwake(): Promise<() => void> {
  let sentinel: WakeLockSentinel | undefined;
  const acquire = async () => {
    try {
      sentinel = await navigator.wakeLock?.request('screen');
    } catch {
      /* denied */
    }
  };
  const onVis = () => document.visibilityState === 'visible' && void acquire();
  await acquire();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    void sentinel?.release().catch(() => {});
  };
}

/** Android hardware back button. Handler returns true if it handled navigation. */
export async function onBackButton(handler: () => boolean): Promise<() => void> {
  if (!isNativeAndroid) return () => {};
  const { App } = await import('@capacitor/app');
  const sub = await App.addListener('backButton', () => {
    if (!handler()) void App.exitApp();
  });
  return () => void sub.remove();
}

/** Pause work when the app is backgrounded (Android lifecycle / tab visibility). */
export async function onAppStateChange(cb: (active: boolean) => void): Promise<() => void> {
  if (isNativeAndroid) {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('appStateChange', (s) => cb(s.isActive));
    return () => void sub.remove();
  }
  const h = () => cb(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

export async function notify(title: string, body: string) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body, icon: './logo.svg' });
  } catch {
    /* unsupported */
  }
}

/** Register the PWA service worker (web only; native shells serve files locally). */
export function registerServiceWorker() {
  if (platform !== 'web' || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)));
}
