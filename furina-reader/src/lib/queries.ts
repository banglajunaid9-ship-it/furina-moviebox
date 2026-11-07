import { QueryClient, useQuery } from '@tanstack/react-query';
import { dataEvents, db } from '@/core/db';
import { listCollections, listChapters, listTitles, getTitle, findDuplicateTitles } from '@/core/library';
import { listHistory, progressForTitle, readingStats } from '@/core/progress';
import { listDownloads, offlineUsage } from '@/core/downloads';
import { listExtensions, listOpdsCatalogs, listSources } from '@/core/extensions/registry';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

/** Local DB changes → invalidate the matching query families. */
const DEPENDENTS: Record<string, string[]> = {
  titles: ['titles', 'title', 'stats', 'history', 'duplicates', 'continue'],
  chapters: ['chapters', 'title', 'continue', 'offline', 'updates'],
  progress: ['progress', 'stats', 'continue'],
  history: ['history', 'stats', 'continue'],
  collections: ['collections'],
  downloads: ['downloads', 'offline'],
  sources: ['sources', 'extensions', 'opds'],
};
dataEvents.on((scope) => {
  for (const k of DEPENDENTS[scope] ?? [scope]) void queryClient.invalidateQueries({ queryKey: [k] });
});

export const useTitles = () => useQuery({ queryKey: ['titles'], queryFn: listTitles });
export const useTitle = (id?: string) => useQuery({ queryKey: ['title', id], queryFn: () => (id ? getTitle(id).then((t) => t ?? null) : null), enabled: !!id });
export const useChapters = (titleId?: string) => useQuery({ queryKey: ['chapters', titleId], queryFn: () => listChapters(titleId!), enabled: !!titleId });
export const useProgressMap = (titleId?: string) => useQuery({ queryKey: ['progress', titleId], queryFn: () => progressForTitle(titleId!), enabled: !!titleId });
export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: listCollections });
export const useHistory = () => useQuery({ queryKey: ['history'], queryFn: () => listHistory() });
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: readingStats });
export const useDownloads = () => useQuery({ queryKey: ['downloads'], queryFn: listDownloads });
export const useOfflineUsage = () => useQuery({ queryKey: ['offline'], queryFn: offlineUsage });
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: listSources });
export const useExtensions = () => useQuery({ queryKey: ['extensions'], queryFn: listExtensions });
export const useOpds = () => useQuery({ queryKey: ['opds'], queryFn: listOpdsCatalogs });
export const useDuplicates = () => useQuery({ queryKey: ['duplicates'], queryFn: findDuplicateTitles });

/** Titles with progress, most recent first, with the chapter to resume. */
export const useContinueReading = () =>
  useQuery({
    queryKey: ['continue'],
    queryFn: async () => {
      const d = await db();
      const all = await d.getAllFromIndex('progress', 'byUpdated');
      const seen = new Set<string>();
      const out: { titleId: string; chapterId: string; page: number; pageCount: number; updatedAt: number }[] = [];
      for (let i = all.length - 1; i >= 0 && out.length < 12; i--) {
        const p = all[i];
        if (seen.has(p.titleId)) continue;
        seen.add(p.titleId);
        out.push(p);
      }
      const titles = await Promise.all(out.map((p) => d.get('titles', p.titleId)));
      const chapters = await Promise.all(out.map((p) => d.get('chapters', p.chapterId)));
      return out
        .map((p, i) => ({ ...p, title: titles[i], chapter: chapters[i] }))
        .filter((x) => x.title && !x.title.deleted && x.title.inLibrary && x.chapter && !x.chapter.deleted);
    },
  });

/** Chapters marked new by update checks, plus recently imported chapters. */
export const useUpdates = () =>
  useQuery({
    queryKey: ['updates'],
    queryFn: async () => {
      const d = await db();
      const chapters = (await d.getAll('chapters')).filter((c) => !c.deleted).sort((a, b) => b.addedAt - a.addedAt).slice(0, 150);
      const titles = new Map((await d.getAll('titles')).map((t) => [t.id, t]));
      return chapters.map((c) => ({ chapter: c, title: titles.get(c.titleId) })).filter((x) => x.title && !x.title.deleted && x.title.inLibrary);
    },
  });
