import { useEffect, useState, type ChangeEvent } from 'react';
import { ThemeDecoration } from '../components/ThemeDecoration';
import type { WeddingTheme } from '../lib/themes';

const MAX_FILES = 30;
const MEGABYTE = 1024 * 1024;
const MEDIA_LIMITS: Record<string, number> = {
  'image/jpeg': 20 * MEGABYTE,
  'image/png': 20 * MEGABYTE,
  'image/webp': 20 * MEGABYTE,
  'image/heic': 20 * MEGABYTE,
  'image/heif': 20 * MEGABYTE,
  'video/mp4': 500 * MEGABYTE,
  'video/quicktime': 500 * MEGABYTE,
};

const ACCEPTED_TYPES = Object.keys(MEDIA_LIMITS).join(',');

type UploadStatus = 'waiting' | 'uploading' | 'completed' | 'error';

type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number | null;
  error?: string;
};

type CreateMediaResponse = {
  mediaId: number;
  uploadUrl: string;
  method: string;
};

const statusLabels: Record<UploadStatus, string> = {
  waiting: 'In attesa',
  uploading: 'Caricamento',
  completed: 'Completato',
  error: 'Errore',
};

function formatSize(size: number): string {
  if (size >= MEGABYTE) return `${(size / MEGABYTE).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function validateFile(file: File): string | null {
  const limit = MEDIA_LIMITS[file.type];
  if (!limit) return 'Tipo di file non supportato.';
  if (file.size <= 0) return 'Il file è vuoto.';
  if (file.size > limit) {
    return file.type.startsWith('video/')
      ? 'Il video supera il limite di 500 MB.'
      : 'La foto supera il limite di 20 MB.';
  }
  return null;
}

function putFile(
  uploadUrl: string,
  method: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, uploadUrl);
    request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error('put'));
    };
    request.onerror = () => reject(new Error('put'));
    request.onabort = () => reject(new Error('put'));
    request.send(file);
  });
}

type PhotoPageProps = {
  theme: WeddingTheme;
};

export function PhotoPage({ theme }: PhotoPageProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [selectionError, setSelectionError] = useState('');
  const [guestUploadsEnabled, setGuestUploadsEnabled] = useState<boolean | null>(null);
  const isUploading = items.some((item) => item.status === 'waiting' || item.status === 'uploading');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/wedding/settings', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('settings');
        return response.json() as Promise<{ guestUploadsEnabled: boolean }>;
      })
      .then((settings) => setGuestUploadsEnabled(settings.guestUploadsEnabled === true))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setGuestUploadsEnabled(true);
        }
      });
    return () => controller.abort();
  }, []);

  const updateItem = (id: string, update: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)));
  };

  const uploadItem = async (item: UploadItem) => {
    updateItem(item.id, { status: 'uploading', progress: null, error: undefined });

    let media: CreateMediaResponse;
    try {
      const response = await fetch('/api/media/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name,
          mimeType: item.file.type,
          size: item.file.size,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { code?: string } | null;
        if (error?.code === 'guest_uploads_disabled') {
          setGuestUploadsEnabled(false);
          throw new Error('disabled');
        }
        throw new Error('create');
      }
      media = await response.json() as CreateMediaResponse;
      if (!Number.isSafeInteger(media.mediaId) || !media.uploadUrl || media.method !== 'PUT') {
        throw new Error('create');
      }
    } catch (error) {
      updateItem(item.id, {
        status: 'error',
        error: error instanceof Error && error.message === 'disabled'
          ? 'La condivisione delle foto non è attiva in questo momento.'
          : 'Non siamo riusciti a preparare il caricamento.',
      });
      return;
    }

    try {
      await putFile(media.uploadUrl, media.method, item.file, (progress) => {
        updateItem(item.id, { progress });
      });
    } catch {
      updateItem(item.id, { status: 'error', progress: null, error: 'Il caricamento del file non è riuscito.' });
      return;
    }

    try {
      const response = await fetch(`/api/media/${media.mediaId}/complete`, { method: 'POST' });
      if (!response.ok) throw new Error('complete');
      updateItem(item.id, { status: 'completed', progress: 100 });
    } catch {
      updateItem(item.id, {
        status: 'error',
        progress: null,
        error: 'File caricato, ma non è stato possibile completare la registrazione.',
      });
    }
  };

  const runQueue = async (queuedItems: UploadItem[]) => {
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < queuedItems.length) {
        const item = queuedItems[nextIndex++];
        await uploadItem(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queuedItems.length) }, worker));
  };

  const handleSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setSelectionError('');

    if (files.length > MAX_FILES) {
      setSelectionError('Puoi selezionare al massimo 30 file alla volta. Nessun upload è stato avviato.');
      return;
    }

    const selectedItems = files.map<UploadItem>((file) => {
      const error = validateFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        status: error ? 'error' : 'waiting',
        progress: null,
        error: error ?? undefined,
      };
    });
    setItems(selectedItems);

    const validItems = selectedItems.filter((item) => item.status === 'waiting');
    if (validItems.length > 0) void runQueue(validItems);
  };

  return (
    <main className="photo-page">
      <section className="photo-hero" aria-labelledby="photo-title">
        <p className="section-title__eyebrow">I vostri scatti</p>
        <h1 id="photo-title">Condividi i tuoi<br />ricordi</h1>
        <p className="photo-hero__copy">Foto belle, foto brutte, foto assurde.<br />Le vogliamo tutte.</p>

        {guestUploadsEnabled === false ? (
          <p className="photo-hero__unavailable">La condivisione delle foto non è attiva in questo momento.</p>
        ) : (
          <>
            <label className={`button button--solid upload-picker${isUploading || guestUploadsEnabled === null ? ' upload-picker--disabled' : ''}`}>
              {guestUploadsEnabled === null ? 'Caricamento…' : 'Carica foto e video'}
              <input
                type="file"
                multiple
                accept={ACCEPTED_TYPES}
                disabled={isUploading || guestUploadsEnabled === null}
                onChange={handleSelection}
              />
            </label>
            <p className="upload-limits">Massimo 30 file · Foto fino a 20 MB · Video fino a 500 MB</p>
          </>
        )}
        {selectionError && <p className="upload-selection-error" role="alert">{selectionError}</p>}
        <ThemeDecoration theme={theme} slot="divider" />
        <p className="photo-hero__note">I vostri scatti, i nostri ricordi.</p>
      </section>

      {items.length > 0 && (
        <section className="upload-section" aria-labelledby="upload-list-title">
          <div className="upload-section__heading">
            <h2 id="upload-list-title">I tuoi file</h2>
            <span>{items.length}</span>
          </div>
          <ul className="upload-list" aria-live="polite">
            {items.map((item) => (
              <li className="upload-item" key={item.id} data-status={item.status}>
                <div className="upload-item__content">
                  <p className="upload-item__name">{item.file.name}</p>
                  <p className="upload-item__meta">{formatSize(item.file.size)}</p>
                  {item.error && <p className="upload-item__error">{item.error}</p>}
                </div>
                <div className="upload-item__state">
                  <span>{statusLabels[item.status]}</span>
                  {item.status === 'uploading' && item.progress !== null && (
                    <strong>{item.progress}%</strong>
                  )}
                </div>
                {item.status === 'uploading' && (
                  <progress
                    className="upload-item__progress"
                    max="100"
                    value={item.progress ?? undefined}
                    aria-label={`Caricamento di ${item.file.name}`}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
