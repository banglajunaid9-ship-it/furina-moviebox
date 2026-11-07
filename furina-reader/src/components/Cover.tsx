import { useEffect, useState } from 'react';
import { getFileBlob } from '@/core/library';
import { cn } from './ui';

/** Resolves `file:<id>` covers from IndexedDB, falls back to a generated cover. */
export function useCoverUrl(cover?: string) {
  const [url, setUrl] = useState<string | undefined>(cover && !cover.startsWith('file:') ? cover : undefined);
  useEffect(() => {
    if (!cover) return setUrl(undefined);
    if (!cover.startsWith('file:')) return setUrl(cover);
    let revoked = false;
    let u: string | undefined;
    void getFileBlob(cover.slice(5)).then((b) => {
      if (revoked || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      revoked = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [cover]);
  return url;
}

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function Cover({ cover, title, className, rounded = 'rounded-xl', eager }: { cover?: string; title: string; className?: string; rounded?: string; eager?: boolean }) {
  const url = useCoverUrl(cover);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [url]);
  const h = hue(title);
  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden bg-raised', rounded, className)}>
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('h-full w-full object-cover transition duration-500', loaded ? 'opacity-100' : 'opacity-0')}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col justify-end p-3"
          style={{ background: `linear-gradient(160deg, hsl(${h} 55% 32%), hsl(${(h + 60) % 360} 60% 16%))` }}
          aria-hidden
        >
          <span className="line-clamp-4 font-display text-[15px] font-semibold leading-tight text-white/95">{title}</span>
        </div>
      )}
      {url && !failed && !loaded && <div className="skeleton absolute inset-0 rounded-none" />}
    </div>
  );
}
