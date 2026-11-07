/**
 * AniList GraphQL — public, documented metadata API (https://docs.anilist.co).
 * Used for discovery only: covers, synopses, genres, trending. It provides no pages.
 * Rate limit: 90 req/min; we cache responses in memory for 10 minutes.
 */
const ENDPOINT = 'https://graphql.anilist.co';

export interface MetaTitle {
  id: number;
  title: string;
  altTitles: string[];
  cover: string;
  banner?: string;
  color?: string;
  description: string;
  genres: string[];
  authors: string[];
  artists: string[];
  score?: number;
  status?: string;
  chapters?: number;
  country?: string;
  format?: string;
  year?: number;
  siteUrl: string;
}

export type MetaSort = 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'UPDATED_AT_DESC' | 'START_DATE_DESC' | 'SEARCH_MATCH';

export const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
  'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

export const COUNTRIES = [
  { id: '', label: 'All origins' },
  { id: 'JP', label: 'Manga (JP)' },
  { id: 'KR', label: 'Manhwa (KR)' },
  { id: 'CN', label: 'Manhua (CN)' },
  { id: 'TW', label: 'Taiwan' },
];

const FIELDS = `id siteUrl title { romaji english native userPreferred } synonyms
coverImage { extraLarge large color } bannerImage description(asHtml:false) genres averageScore status chapters
countryOfOrigin format startDate { year }
staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }`;

const cache = new Map<string, { at: number; data: unknown }>();

async function gql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const key = JSON.stringify([query, variables]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data as T;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (res.status === 429) throw new Error('AniList rate limit reached — try again in a minute.');
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(json.errors?.[0]?.message ?? `AniList error ${res.status}`);
  cache.set(key, { at: Date.now(), data: json.data });
  return json.data as T;
}

function clean(desc: string | null): string {
  if (!desc) return '';
  return desc
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function map(m: any): MetaTitle {
  const staff: { role: string; node: { name: { full: string } } }[] = m.staff?.edges ?? [];
  const story = staff.filter((s) => /story|original creator|author/i.test(s.role)).map((s) => s.node.name.full);
  const art = staff.filter((s) => /art/i.test(s.role)).map((s) => s.node.name.full);
  const title = m.title.english || m.title.userPreferred || m.title.romaji;
  return {
    id: m.id,
    title,
    altTitles: [...new Set([m.title.romaji, m.title.english, m.title.native, ...(m.synonyms ?? [])].filter((x: string) => x && x !== title))],
    cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
    banner: m.bannerImage ?? undefined,
    color: m.coverImage?.color ?? undefined,
    description: clean(m.description),
    genres: m.genres ?? [],
    authors: [...new Set(story)],
    artists: [...new Set(art)],
    score: m.averageScore ?? undefined,
    status: m.status ?? undefined,
    chapters: m.chapters ?? undefined,
    country: m.countryOfOrigin ?? undefined,
    format: m.format ?? undefined,
    year: m.startDate?.year ?? undefined,
    siteUrl: m.siteUrl,
  };
}

export interface BrowseParams {
  search?: string;
  sort?: MetaSort;
  genres?: string[];
  country?: string;
  page?: number;
  perPage?: number;
}

export async function browse(p: BrowseParams, signal?: AbortSignal): Promise<{ items: MetaTitle[]; hasNext: boolean }> {
  const q = `query ($page:Int,$perPage:Int,$search:String,$sort:[MediaSort],$genres:[String],$country:CountryCode) {
    Page(page:$page, perPage:$perPage) { pageInfo { hasNextPage }
      media(type: MANGA, isAdult: false, search:$search, sort:$sort, genre_in:$genres, countryOfOrigin:$country) { ${FIELDS} } } }`;
  const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: unknown[] } }>(
    q,
    {
      page: p.page ?? 1,
      perPage: p.perPage ?? 24,
      search: p.search?.trim() || undefined,
      sort: [p.sort ?? (p.search ? 'SEARCH_MATCH' : 'TRENDING_DESC')],
      genres: p.genres?.length ? p.genres : undefined,
      country: p.country || undefined,
    },
    signal,
  );
  return { items: data.Page.media.map(map), hasNext: data.Page.pageInfo.hasNextPage };
}

export async function details(id: number, signal?: AbortSignal): Promise<MetaTitle> {
  const data = await gql<{ Media: unknown }>(`query ($id:Int) { Media(id:$id, type: MANGA) { ${FIELDS} } }`, { id }, signal);
  return map(data.Media);
}
