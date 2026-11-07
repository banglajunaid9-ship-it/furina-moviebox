import { FileUp, FolderUp, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { importFiles, type ImportResult } from '@/core/library';
import { Button, Dialog, toast, type ButtonProps } from './ui';

export const ACCEPT = '.cbz,.cbr,.zip,.rar,.epub,.pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,application/pdf,application/epub+zip,image/*';

let running = false;

function useImporter(intoTitleId?: string) {
  const nav = useNavigate();
  const [state, setState] = useState<{ done: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = async (files: File[]) => {
    if (!files.length || running) return;
    running = true;
    setState({ done: 0, total: files.length, name: '' });
    try {
      const r = await importFiles(files, { intoTitleId, onProgress: (done, total, name) => setState({ done, total, name }) });
      setState(null);
      if (r.errors.length || r.duplicates.length) setResult(r);
      if (r.added.length) {
        toast(`Imported ${r.added.length} chapter${r.added.length > 1 ? 's' : ''}`, 'success');
        const titles = new Set(r.added.map((a) => a.titleId));
        if (titles.size === 1 && !intoTitleId) nav(`/title/${[...titles][0]}`);
      } else if (!r.errors.length && !r.duplicates.length) toast('Nothing to import');
    } finally {
      running = false;
      setState(null);
    }
  };
  const ui = (
    <>
      <Dialog open={!!state} onClose={() => {}} title="Importing">
        {state && (
          <div className="space-y-3 py-2" aria-live="polite">
            <p className="truncate text-sm text-muted">{state.name || 'Reading files…'}</p>
            <div className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full accent-gradient transition-all" style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
            </div>
            <p className="text-xs text-muted">
              {state.done} of {state.total}
            </p>
          </div>
        )}
      </Dialog>
      <Dialog open={!!result} onClose={() => setResult(null)} title="Import finished" footer={<Button onClick={() => setResult(null)}>Done</Button>}>
        {result && (
          <div className="space-y-4 text-sm">
            <p>
              <b>{result.added.length}</b> added
              {result.duplicates.length > 0 && <>, <b>{result.duplicates.length}</b> skipped as duplicates</>}
              {result.errors.length > 0 && <>, <b className="text-danger">{result.errors.length}</b> failed</>}.
            </p>
            {result.duplicates.length > 0 && (
              <div>
                <p className="label">Already in your library</p>
                <ul className="list-inside list-disc text-muted">
                  {result.duplicates.map((d) => (
                    <li key={d} className="truncate">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div>
                <p className="label">Could not import</p>
                <ul className="space-y-1">
                  {result.errors.map((e) => (
                    <li key={e.name} className="rounded-lg bg-danger/10 px-3 py-2">
                      <span className="block truncate font-semibold">{e.name}</span>
                      <span className="text-xs text-muted">{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
  return { run, ui };
}

export function ImportButton({ intoTitleId, label = 'Import files', ...p }: ButtonProps & { intoTitleId?: string; label?: string }) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const { run, ui } = useImporter(intoTitleId);
  return (
    <>
      <div className="inline-flex">
        <Button {...p} className={'rounded-r-none ' + (p.className ?? '')} onClick={() => files.current?.click()}>
          <FileUp className="h-4 w-4" /> {label}
        </Button>
        <Button {...p} className="rounded-l-none border-l-0 px-3" onClick={() => folder.current?.click()} title="Import a folder of images" aria-label="Import a folder of images">
          <FolderUp className="h-4 w-4" />
        </Button>
      </div>
      <input
        ref={files}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        data-testid="import-input"
        onChange={(e) => {
          void run([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <input
        ref={folder}
        type="file"
        hidden
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        onChange={(e) => {
          void run([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {ui}
    </>
  );
}

/** Drop files anywhere in the app to import them. */
export function ImportDropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  const { run, ui } = useImporter();
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void run([...e.dataTransfer.files]);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-bg/80 backdrop-blur-sm" onDragLeave={() => setOver(false)}>
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/60 px-16 py-12 text-center">
            <Upload className="h-10 w-10 text-accent" />
            <p className="font-display text-xl">Drop to add to your library</p>
            <p className="text-sm text-muted">CBZ · CBR · ZIP · EPUB · PDF · images</p>
          </div>
        </div>
      )}
      {ui}
    </div>
  );
}
