import { useEffect, useRef, useState } from 'react';

type GalleryMedia = {
  id: number;
  uuid: string;
  source: string;
  mimeType: string;
  createdAt: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  previewStatus: string;
};

type GalleryResponse = {
  galleryEnabled: boolean;
  media: GalleryMedia[];
};

const heicTypes = new Set(['image/heic', 'image/heif']);

function MediaPlaceholder({ kind }: { kind: 'heic' | 'video' | 'unavailable' }) {
  const labels = {
    heic: ['Formato HEIC', 'La preview sarà disponibile prossimamente'],
    video: ['Video', 'La riproduzione sarà disponibile prossimamente'],
    unavailable: ['Anteprima non disponibile', 'Il ricordo resta custodito nella gallery'],
  } as const;
  return (
    <div className="gallery-placeholder">
      <span aria-hidden="true">{kind === 'video' ? '▶' : '✦'}</span>
      <strong>{labels[kind][0]}</strong>
      <small>{labels[kind][1]}</small>
    </div>
  );
}

function GalleryImage({ media, large = false }: { media: GalleryMedia; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = large ? media.previewUrl : media.thumbnailUrl;
  if (failed || !source) return <MediaPlaceholder kind="unavailable" />;
  return (
    <img
      className={large ? 'gallery-dialog__image' : 'gallery-item__image'}
      src={source}
      alt="Ricordo condiviso dagli invitati"
      loading={large ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
    />
  );
}

export function GalleryPage() {
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [galleryEnabled, setGalleryEnabled] = useState(true);
  const [selected, setSelected] = useState<GalleryMedia | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/gallery', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('gallery');
        return response.json() as Promise<GalleryResponse>;
      })
      .then((result) => {
        setGalleryEnabled(result.galleryEnabled !== false);
        setMedia(Array.isArray(result.media) ? result.media : []);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected && dialog && !dialog.open) dialog.showModal();
  }, [selected]);

  const closeDialog = () => dialogRef.current?.close();

  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <p className="section-title__eyebrow">Momenti condivisi</p>
        <h1>I nostri ricordi</h1>
        <p>Gli scatti più belli della nostra giornata, raccolti qui insieme.</p>
      </header>

      {status === 'loading' && <p className="gallery-state">Stiamo preparando i ricordi…</p>}
      {status === 'error' && <p className="gallery-state">La gallery non è disponibile in questo momento.</p>}
      {status === 'ready' && !galleryEnabled && (
        <p className="gallery-state">La gallery non è ancora disponibile.</p>
      )}
      {status === 'ready' && galleryEnabled && media.length === 0 && (
        <p className="gallery-state">I primi ricordi arriveranno presto.</p>
      )}

      {galleryEnabled && media.length > 0 && (
        <section className="gallery-grid" data-count={media.length} aria-label="Gallery fotografica">
          {media.map((item) => {
            if (
              item.mimeType.startsWith('image/')
              && item.previewStatus === 'ready'
              && item.thumbnailUrl
              && item.previewUrl
            ) {
              return (
                <button
                  className="gallery-item gallery-item--image"
                  type="button"
                  key={item.id}
                  onClick={() => setSelected(item)}
                  aria-label="Apri il ricordo a schermo intero"
                >
                  <GalleryImage media={item} />
                </button>
              );
            }
            return (
              <article className="gallery-item" key={item.id}>
                <MediaPlaceholder
                  kind={item.mimeType.startsWith('video/')
                    ? 'video'
                    : heicTypes.has(item.mimeType)
                      ? 'heic'
                      : 'unavailable'}
                />
              </article>
            );
          })}
        </section>
      )}

      <dialog
        className="gallery-dialog"
        ref={dialogRef}
        aria-label="Visualizzazione ingrandita del ricordo"
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <button type="button" onClick={closeDialog} aria-label="Chiudi immagine">×</button>
        {selected && <GalleryImage media={selected} large />}
      </dialog>
    </main>
  );
}
