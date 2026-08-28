import { useEffect, useState } from 'react';

export type ApprovedMedia = {
  id: number;
  originalFilename: string | null;
  source: string;
  mimeType: string;
  status: string;
  previewStatus: string;
  createdAt: string;
  thumbnailUrl: string | null;
};

type ApprovedMediaPickerProps = {
  selectedId: number | null;
  onSelect: (media: ApprovedMedia) => void;
  onClose: () => void;
};

async function loadApprovedImages(): Promise<ApprovedMedia[]> {
  const response = await fetch('/api/admin/media?status=approved');
  if (response.status === 401 || response.status === 403) {
    throw new Error('La sessione amministratore è scaduta. Ricarica la pagina.');
  }
  if (!response.ok) throw new Error('Impossibile caricare le immagini approvate.');
  const payload = await response.json() as { media?: ApprovedMedia[] };
  return (payload.media ?? []).filter((media) => (
    media.status === 'approved'
    && media.mimeType.startsWith('image/')
    && media.previewStatus === 'ready'
    && Boolean(media.thumbnailUrl)
  ));
}

export function ApprovedMediaPicker({ selectedId, onSelect, onClose }: ApprovedMediaPickerProps) {
  const [media, setMedia] = useState<ApprovedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadApprovedImages()
      .then((items) => {
        if (!controller.signal.aborted) setMedia(items);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare le immagini.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="approved-media-picker" role="dialog" aria-modal="true" aria-labelledby="approved-media-picker-title">
      <div className="approved-media-picker__panel">
        <div className="approved-media-picker__heading">
          <div><p>Media approvati</p><h3 id="approved-media-picker-title">Scegli una foto</h3></div>
          <button type="button" onClick={onClose} aria-label="Chiudi selezione foto">Chiudi</button>
        </div>
        {loading && <p className="admin-state">Caricamento immagini…</p>}
        {error && <p className="admin-state admin-state--error" role="alert">{error}</p>}
        {!loading && !error && media.length === 0 && (
          <p className="admin-content-empty">Nessuna immagine approvata con preview disponibile.</p>
        )}
        <div className="approved-media-picker__grid">
          {media.map((item) => (
            <article key={item.id} className={item.id === selectedId ? 'is-selected' : ''}>
              <img src={item.thumbnailUrl ?? undefined} alt="" loading="lazy" decoding="async" />
              <div>
                <strong>{item.originalFilename || `Media ${item.id}`}</strong>
                <span>{item.source} · {new Date(item.createdAt).toLocaleDateString('it-IT')}</span>
              </div>
              <button type="button" onClick={() => onSelect(item)}>
                {item.id === selectedId ? 'Selezionata' : 'Seleziona'}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
