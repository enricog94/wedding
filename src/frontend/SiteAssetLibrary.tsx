import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminImage } from './AdminImage';
import {
  deleteSiteAsset,
  listSiteAssets,
  SITE_ASSET_ACCEPT,
  type SiteAsset,
  type SiteAssetType,
  uploadSiteAsset,
} from './siteAssets';

const assetTypeLabels: Record<SiteAssetType, string> = {
  hero: 'Hero', story: 'Storia', location: 'Location', info: 'Info', other: 'Altro',
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type SiteAssetLibraryProps = {
  filter?: SiteAssetType;
  initialUploadType?: SiteAssetType;
  selectedId?: number | null;
  onSelect?: (asset: SiteAsset) => void;
  allowDelete?: boolean;
};

export function SiteAssetLibrary({
  filter,
  initialUploadType = filter ?? 'other',
  selectedId = null,
  onSelect,
  allowDelete = true,
}: SiteAssetLibraryProps) {
  const [assets, setAssets] = useState<SiteAsset[]>([]);
  const [uploadType, setUploadType] = useState<SiteAssetType>(initialUploadType);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setAssets(await listSiteAssets(filter));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare i media del sito.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!assets.some((asset) => asset.status === 'processing')) return;
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
  }, [assets, load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      await uploadSiteAsset(file, uploadType);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Caricamento non riuscito.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (asset: SiteAsset) => {
    if (!window.confirm(`Eliminare definitivamente “${asset.originalFilename || 'questa immagine'}”?`)) return;
    setBusy(true); setError('');
    try {
      await deleteSiteAsset(asset.id);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Eliminazione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="site-asset-library" aria-label="Media del sito">
      <div className="site-asset-library__toolbar">
        <label>Categoria
          <select value={uploadType} disabled={busy || Boolean(filter)} onChange={(event) => setUploadType(event.target.value as SiteAssetType)}>
            {Object.entries(assetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="site-asset-upload">
          <span>{busy ? 'Caricamento…' : '+ Carica immagine'}</span>
          <input ref={inputRef} type="file" accept={SITE_ASSET_ACCEPT} disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />
        </label>
      </div>
      {error && <p className="admin-state admin-state--error" role="alert">{error}</p>}
      {loading && <p className="admin-state">Caricamento media sito…</p>}
      {!loading && !error && assets.length === 0 && <p className="admin-content-empty">Nessuna immagine editoriale caricata.</p>}
      <div className="site-asset-grid">
        {assets.map((asset) => (
          <article key={asset.id} className={asset.id === selectedId ? 'is-selected' : ''}>
            {asset.viewUrl ? <AdminImage source={asset.viewUrl} alt="" loading="lazy" decoding="async" /> : <div className="site-asset-placeholder">{asset.status}</div>}
            <div className="site-asset-card__body">
              <strong title={asset.originalFilename ?? undefined}>{asset.originalFilename || `Asset ${asset.id}`}</strong>
              <span>{assetTypeLabels[asset.assetType]} · {formatSize(asset.sizeBytes)}</span>
              <span>{asset.status}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</span>
              <span>{new Date(asset.createdAt).toLocaleDateString('it-IT')}</span>
              <div>
                {onSelect && asset.status === 'ready' && <button type="button" disabled={busy} onClick={() => onSelect(asset)}>{asset.id === selectedId ? 'Selezionata' : 'Seleziona'}</button>}
                {allowDelete && <button type="button" className="admin-danger" disabled={busy} onClick={() => void remove(asset)}>Elimina</button>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
