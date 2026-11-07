import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiConfig } from '@/core/ai/assistant';
import type { OrientationPref } from '@/platform';

export type ReaderMode = 'single' | 'double' | 'webtoon';
export type Direction = 'ltr' | 'rtl';
export type Fit = 'width' | 'height' | 'contain' | 'original';
export type ReaderBg = 'black' | 'dark' | 'gray' | 'white' | 'sepia';

export interface ReaderPrefs {
  mode: ReaderMode;
  direction: Direction;
  fit: Fit;
  background: ReaderBg;
  /** gap between webtoon pages / padding around paged pages, px */
  margin: number;
  /** 0.2 – 1 */
  brightness: number;
  /** pages to preload ahead */
  preload: number;
  tapZones: boolean;
  /** webtoon column width as % of viewport (desktop) */
  webtoonWidth: number;
  showPageNumber: boolean;
  doubleCoverAlone: boolean;
  orientation: OrientationPref;
  keepAwake: boolean;
}

export const ACCENTS = {
  violet: { label: 'Hydro Violet', accent: '139 123 255', accent2: '79 141 255' },
  azure: { label: 'Fontaine Azure', accent: '79 141 255', accent2: '56 214 222' },
  rose: { label: 'Opera Rose', accent: '240 110 170', accent2: '160 120 255' },
  gold: { label: 'Gilded', accent: '233 186 92', accent2: '240 130 90' },
  teal: { label: 'Tidewater', accent: '45 205 175', accent2: '79 141 255' },
} as const;
export type AccentId = keyof typeof ACCENTS;

interface SettingsState {
  theme: 'dark' | 'light' | 'system';
  accent: AccentId;
  reduceMotion: boolean;
  sidebarCollapsed: boolean;
  reader: ReaderPrefs;
  /** per-title overrides (mode/direction) — webtoons vs manga */
  perTitle: Record<string, Partial<Pick<ReaderPrefs, 'mode' | 'direction' | 'fit'>>>;
  ai: AiConfig;
  librarySort: 'title' | 'lastRead' | 'added' | 'updated';
  libraryView: 'grid' | 'list';
  set: (p: Partial<Omit<SettingsState, 'set' | 'setReader' | 'setTitlePref'>>) => void;
  setReader: (p: Partial<ReaderPrefs>) => void;
  setTitlePref: (titleId: string, p: Partial<Pick<ReaderPrefs, 'mode' | 'direction' | 'fit'>>) => void;
}

export const DEFAULT_READER: ReaderPrefs = {
  mode: 'single',
  direction: 'ltr',
  fit: 'contain',
  background: 'black',
  margin: 0,
  brightness: 1,
  preload: 3,
  tapZones: true,
  webtoonWidth: 60,
  showPageNumber: true,
  doubleCoverAlone: true,
  orientation: 'auto',
  keepAwake: true,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accent: 'violet',
      reduceMotion: false,
      sidebarCollapsed: false,
      reader: DEFAULT_READER,
      perTitle: {},
      ai: { transport: 'cloud', endpoint: 'http://localhost:11434/v1', model: 'llama3.2', allowSpoilers: false },
      librarySort: 'lastRead',
      libraryView: 'grid',
      set: (p) => set(p),
      setReader: (p) => set((s) => ({ reader: { ...s.reader, ...p } })),
      setTitlePref: (id, p) => set((s) => ({ perTitle: { ...s.perTitle, [id]: { ...s.perTitle[id], ...p } } })),
    }),
    {
      name: 'furina.settings',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, reader: { ...DEFAULT_READER, ...p.reader }, ai: { ...current.ai, ...p.ai } };
      },
    },
  ),
);

/** Apply theme + accent tokens to <html>. */
export function applyTheme(theme: SettingsState['theme'], accent: AccentId, reduceMotion: boolean) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.classList.toggle('reduce-motion', reduceMotion);
  const a = ACCENTS[accent] ?? ACCENTS.violet;
  root.style.setProperty('--accent', a.accent);
  root.style.setProperty('--accent-2', a.accent2);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0c1f' : '#f5f4ff');
}
