import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminContent } from './AdminContent';
import { adminFetch } from './adminApi';
import { useAdminImageUrl } from './useAdminImageUrl';

type MediaStatus = 'uploading' | 'pending' | 'approved' | 'hidden';
type MediaSource = 'guest' | 'photobooth' | 'admin';
type AdminTab = 'dashboard' | 'content' | 'gallery' | 'settings';
type MediaAction = 'approve' | 'hide' | 'restore';
type BulkAction = 'approve' | 'hide' | 'delete';

type AdminMedia = {
  id: number;
  uuid: string;
  source: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  status: MediaStatus;
  previewStatus: string;
  previewError: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  uploadedAt: string | null;
};

type AdminStats = {
  total: number;
  pending: number;
  approved: number;
  hidden: number;
  photos: number;
  videos: number;
  storageBytes: number;
};

type AdminMediaResponse = { media: AdminMedia[]; stats: AdminStats };

type AdminSettings = {
  galleryEnabled: boolean;
  galleryPreviewEnabled: boolean;
  galleryDownloadEnabled: boolean;
  guestUploadsEnabled: boolean;
  requireGuestApproval: boolean;
  photoboothAutoApprove: boolean;
  scheduleEnabled: boolean;
  locationsEnabled: boolean;
  infoEnabled: boolean;
};

const EMPTY_STATS: AdminStats = {
  total: 0, pending: 0, approved: 0, hidden: 0,
  photos: 0, videos: 0, storageBytes: 0,
};

const DEFAULT_SETTINGS: AdminSettings = {
  galleryEnabled: true,
  galleryPreviewEnabled: true,
  galleryDownloadEnabled: true,
  guestUploadsEnabled: true,
  requireGuestApproval: true,
  photoboothAutoApprove: true,
  scheduleEnabled: true,
  locationsEnabled: true,
  infoEnabled: true,
};

async function adminResponse(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await adminFetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const detail = error instanceof Error ? error.message : 'errore di rete';
    throw new Error(`${url}: richiesta non completata (${detail}).`);
  }
  if (response.type === 'opaqueredirect') {
    throw new Error(`${url}: autenticazione richiesta (redirect).`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(`${url}: HTTP ${response.status}${payload?.error ? ` - ${payload.error}` : ''}`);
  }
  return response;
}

const statusLabels: Record<MediaStatus, string> = {
  uploading: 'In caricamento', pending: 'Pending', approved: 'Approvato', hidden: 'Nascosto',
};

function formatSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string | null): string {
  if (!value) return 'Data non disponibile';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function AdminPreview({ item }: { item: AdminMedia }) {
  const thumbnailSource = item.previewStatus === 'ready' ? item.thumbnailUrl : null;
  const source = useAdminImageUrl(thumbnailSource);

  if (source) {
    return <img src={source} alt="Anteprima del media" loading="lazy" />;
  }

  const isVideo = item.mimeType.startsWith('video/');
  const placeholder = item.previewStatus === 'pending'
    ? 'Anteprima in attesa'
    : item.previewStatus === 'processing'
      ? 'Elaborazione anteprima…'
      : item.previewStatus === 'failed'
        ? 'Elaborazione anteprima fallita'
        : isVideo
          ? 'Video'
          : item.mimeType.includes('hei')
            ? 'HEIC / HEIF'
            : 'Anteprima non disponibile';
  return (
    <div className="admin-media__placeholder">
      <span aria-hidden="true">{isVideo ? '▶' : '✦'}</span>
      <strong>{placeholder}</strong>
      {item.previewStatus === 'failed' && item.previewError && <small>{item.previewError}</small>}
    </div>
  );
}

function hasReadyApprovalPreview(item: AdminMedia): boolean {
  return !item.mimeType.startsWith('image/') || item.previewStatus === 'ready';
}

function canApprove(item: AdminMedia): boolean {
  return item.status === 'pending' && hasReadyApprovalPreview(item);
}

function canRestore(item: AdminMedia): boolean {
  return item.status === 'hidden' && hasReadyApprovalPreview(item);
}

type ToggleProps = {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

function SettingsToggle({ checked, description, disabled, label, onChange }: ToggleProps) {
  return (
    <label className="admin-toggle">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

type AdminPageProps = {
  adminEmail?: string;
  onLogout: () => void;
};

export function AdminPage({ adminEmail, onLogout }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [statusFilter, setStatusFilter] = useState<'all' | MediaStatus>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | MediaSource>('all');
  const [media, setMedia] = useState<AdminMedia[]>([]);
  const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [actionError, setActionError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState('');

  const query = useMemo(() => new URLSearchParams({
    status: tab === 'dashboard' ? 'pending' : statusFilter,
    source: tab === 'dashboard' ? 'all' : sourceFilter,
  }).toString(), [sourceFilter, statusFilter, tab]);

  const loadMedia = useCallback(async () => {
    if (tab === 'settings' || tab === 'content') return;
    setLoading(true);
    setMediaError('');
    try {
      const response = await adminResponse(`/api/admin/media?${query}&_=${Date.now()}`, {
        cache: 'no-store',
      });
      const result = await response.json() as AdminMediaResponse;
      setMedia(Array.isArray(result.media) ? result.media : []);
      setStats(result.stats ?? EMPTY_STATS);
      setSelected(new Set());
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Impossibile caricare i media.');
    } finally {
      setLoading(false);
    }
  }, [query, tab]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadMedia(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadMedia]);

  useEffect(() => {
    const controller = new AbortController();
    adminResponse('/api/admin/settings', { signal: controller.signal })
      .then((response) => response.json() as Promise<AdminSettings>)
      .then(setSettings)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSettingsError(error instanceof Error ? error.message : '/api/admin/settings: richiesta non riuscita.');
        }
      })
      .finally(() => setSettingsLoading(false));
    return () => controller.abort();
  }, []);

  const finishAction = async (message: string) => {
    setFeedback(message);
    await loadMedia();
  };

  const moderate = async (id: number, action: MediaAction) => {
    setBusy(true); setFeedback(''); setActionError('');
    try {
      const response = await adminResponse(`/api/admin/media/${id}/${action}`, { method: 'POST' });
      const result = await response.json() as { changed?: boolean };
      await finishAction(result.changed === false ? 'Il media era già nello stato richiesto.' : 'Media aggiornato correttamente.');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Operazione non riuscita. Riprova.'); }
    finally { setBusy(false); }
  };

  const removeMedia = async (item: AdminMedia) => {
    if (!window.confirm(`Eliminare definitivamente “${item.originalFilename || 'questo media'}”?`)) return;
    setBusy(true); setFeedback(''); setActionError('');
    try {
      await adminResponse(`/api/admin/media/${item.id}`, { method: 'DELETE' });
      setMedia((current) => current.filter((mediaItem) => mediaItem.id !== item.id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      await finishAction('Media eliminato definitivamente.');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Eliminazione non riuscita. Il media non è stato rimosso.'); }
    finally { setBusy(false); }
  };

  const bulkAction = async (action: BulkAction, ids = [...selected]) => {
    if (ids.length === 0) return;
    if (action === 'delete' && !window.confirm(`Eliminare definitivamente ${ids.length} media selezionati?`)) return;
    setBusy(true); setFeedback(''); setActionError('');
    try {
      const response = await adminResponse('/api/admin/media/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }),
      });
      const result = await response.json() as {
        deletedIds?: number[];
        updatedIds?: number[];
        unchangedIds?: number[];
        previewNotReadyIds?: number[];
        skippedIds?: number[];
      };
      if (action === 'delete') {
        const deletedIds = new Set(result.deletedIds ?? []);
        setMedia((current) => current.filter((item) => !deletedIds.has(item.id)));
      } else {
        const synchronizedIds = new Set([
          ...(result.updatedIds ?? []),
          ...(result.unchangedIds ?? []),
        ]);
        const nextStatus: MediaStatus = action === 'approve' ? 'approved' : 'hidden';
        const visibleStatus = tab === 'dashboard' ? 'pending' : statusFilter;
        setMedia((current) => current.flatMap((item) => {
          if (!synchronizedIds.has(item.id)) return [item];
          if (visibleStatus !== 'all' && visibleStatus !== nextStatus) return [];
          return [{ ...item, status: nextStatus }];
        }));
      }
      setSelected(new Set());
      const changedCount = action === 'delete'
        ? (result.deletedIds?.length ?? 0)
        : (result.updatedIds?.length ?? 0);
      const unchangedCount = result.unchangedIds?.length ?? 0;
      const previewNotReadyCount = result.previewNotReadyIds?.length ?? 0;
      const skippedCount = result.skippedIds?.length ?? 0;
      const summary = [
        `${changedCount} media ${action === 'delete' ? 'eliminati' : 'aggiornati'}`,
        unchangedCount > 0 ? `${unchangedCount} già nello stato richiesto` : '',
        previewNotReadyCount > 0 ? `${previewNotReadyCount} senza anteprima pronta` : '',
        skippedCount > 0 ? `${skippedCount} ignorati` : '',
      ].filter(Boolean).join(' · ');
      await finishAction(`${summary}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Operazione multipla non riuscita. Riprova.'); }
    finally { setBusy(false); }
  };

  const saveSettings = async () => {
    setBusy(true); setFeedback(''); setSettingsError('');
    try {
      const response = await adminResponse('/api/admin/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
      });
      setSettings(await response.json() as AdminSettings);
      setFeedback('Impostazioni salvate.');
    } catch (error) { setSettingsError(error instanceof Error ? error.message : 'Salvataggio delle impostazioni non riuscito.'); }
    finally { setBusy(false); }
  };

  const deleteAll = async () => {
    if (deleteAllConfirmation !== 'ELIMINA TUTTO') return;
    setBusy(true); setFeedback(''); setActionError('');
    try {
      const response = await adminResponse('/api/admin/media', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteAllConfirmation }),
      });
      const result = await response.json() as { deleted: number };
      setDeleteAllConfirmation(''); setStats(EMPTY_STATS); setMedia([]);
      setFeedback(`${result.deleted} media eliminati definitivamente.`);
    } catch { setActionError('Eliminazione completa non riuscita. I dati rimasti non sono stati nascosti dalla UI.'); }
    finally { setBusy(false); }
  };

  const toggleSelected = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allSelected = media.length > 0 && media.every((item) => selected.has(item.id));
  const approvableMediaIds = media.filter(canApprove).map((item) => item.id);
  const selectedApprovableIds = media
    .filter((item) => selected.has(item.id) && canApprove(item))
    .map((item) => item.id);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><p>Serena &amp; Enrico</p><h1>Pannello matrimonio</h1></div>
        <div className="admin-header__session">
          {adminEmail && <span>{adminEmail}</span>}
          <button type="button" onClick={onLogout}>Esci</button>
          <span className="admin-count" aria-label={`${stats.total} media totali`}>{stats.total}</span>
        </div>
      </header>

      {tab === 'dashboard' && !loading && !mediaError && (
        <section className="admin-dashboard" aria-label="Riepilogo media">
          {[
            ['Media totali', stats.total], ['Da approvare', stats.pending], ['Approvati', stats.approved],
            ['Nascosti', stats.hidden], ['Foto', stats.photos], ['Video', stats.videos],
            ['Storage originali', formatSize(stats.storageBytes)],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
      )}

      <nav className="admin-tabs" aria-label="Sezioni amministrazione">
        <button type="button" className={tab === 'dashboard' ? 'is-active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button type="button" className={tab === 'content' ? 'is-active' : ''} onClick={() => setTab('content')}>Contenuti</button>
        <button type="button" className={tab === 'gallery' ? 'is-active' : ''} onClick={() => setTab('gallery')}>Gallery</button>
        <button type="button" className={tab === 'settings' ? 'is-active' : ''} onClick={() => setTab('settings')}>Impostazioni</button>
      </nav>

      {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
      {actionError && <p className="admin-state admin-state--error" role="alert">{actionError}</p>}
      {(tab === 'dashboard' || tab === 'gallery') && mediaError && <p className="admin-state admin-state--error" role="alert">{mediaError}</p>}
      {tab === 'settings' && settingsError && <p className="admin-state admin-state--error" role="alert">{settingsError}</p>}

      {(tab === 'dashboard' || tab === 'gallery') && (
        <>
          <div className="admin-toolbar">
            {tab === 'gallery' ? (
              <div className="admin-filters">
                <label>Stato<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | MediaStatus)}>
                  <option value="all">Tutti</option><option value="pending">Pending</option><option value="approved">Approved</option>
                  <option value="hidden">Hidden</option><option value="uploading">Uploading</option>
                </select></label>
                <label>Origine<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | MediaSource)}>
                  <option value="all">Tutte le origini</option><option value="guest">Guest</option>
                  <option value="photobooth">Photobooth</option><option value="admin">Admin</option>
                </select></label>
              </div>
            ) : <p>Controlla ogni contenuto prima di renderlo visibile nella gallery.</p>}
            {tab === 'dashboard' && media.length > 0 && (
              <button type="button" onClick={() => void bulkAction('approve', approvableMediaIds)} disabled={busy || loading || approvableMediaIds.length === 0}>Approva tutti</button>
            )}
          </div>

          {tab === 'gallery' && media.length > 0 && (
            <div className="admin-bulkbar">
              <label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(media.map((item) => item.id)))} /> Seleziona tutti</label>
              <span>{selected.size} selezionati</span>
              <div>
                <button type="button" disabled={busy || selectedApprovableIds.length === 0} onClick={() => void bulkAction('approve', selectedApprovableIds)}>Approva</button>
                <button type="button" disabled={busy || selected.size === 0} onClick={() => void bulkAction('hide')}>Nascondi</button>
                <button type="button" className="admin-danger" disabled={busy || selected.size === 0} onClick={() => void bulkAction('delete')}>Elimina selezionati</button>
              </div>
            </div>
          )}

          {loading && <p className="admin-state">Caricamento media…</p>}
          {!loading && !mediaError && media.length === 0 && <div className="admin-empty"><span aria-hidden="true">✓</span><p>Nessun media in questa sezione.</p></div>}

          {media.length > 0 && !loading && (
            <section className="admin-grid" aria-label={tab === 'dashboard' ? 'Media da approvare' : 'Tutti i media'}>
              {media.map((item) => (
                <article className="admin-media" key={item.id}>
                  {tab === 'gallery' && <label className="admin-media__select"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} /><span className="sr-only">Seleziona {item.originalFilename || `media ${item.id}`}</span></label>}
                  <div className="admin-media__preview"><AdminPreview key={`${item.id}-${item.previewStatus}-${item.thumbnailUrl ?? 'placeholder'}`} item={item} /></div>
                  <div className="admin-media__body">
                    <div className="admin-media__title"><h2 title={item.originalFilename ?? undefined}>{item.originalFilename || 'File senza nome'}</h2><span data-status={item.status}>{statusLabels[item.status]}</span></div>
                    <dl>
                      <div><dt>Tipo</dt><dd>{item.mimeType}</dd></div><div><dt>Dimensione</dt><dd>{formatSize(item.sizeBytes)}</dd></div>
                      <div><dt>Caricato</dt><dd>{formatDate(item.uploadedAt ?? item.createdAt)}</dd></div><div><dt>Origine</dt><dd>{item.source}</dd></div>
                    </dl>
                    <div className="admin-media__actions">
                      {item.status === 'pending' && <button type="button" disabled={busy || !canApprove(item)} title={!canApprove(item) ? 'Attendi che la preview sia pronta' : undefined} onClick={() => void moderate(item.id, 'approve')}>Approva</button>}
                      {(item.status === 'pending' || item.status === 'approved') && <button type="button" disabled={busy} onClick={() => void moderate(item.id, 'hide')}>Nascondi</button>}
                      {item.status === 'hidden' && <button type="button" disabled={busy || !canRestore(item)} title={!canRestore(item) ? 'Attendi che la preview sia pronta' : undefined} onClick={() => void moderate(item.id, 'restore')}>Ripristina</button>}
                      <button type="button" className="admin-danger" disabled={busy} onClick={() => void removeMedia(item)}>Elimina</button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      {tab === 'content' && <AdminContent />}

      {tab === 'settings' && (
        <section className="admin-settings" aria-labelledby="admin-settings-title">
          <div className="admin-settings__heading"><div><p>Configurazione</p><h2 id="admin-settings-title">Impostazioni</h2></div><button type="button" disabled={busy || settingsLoading} onClick={() => void saveSettings()}>Salva impostazioni</button></div>
          <div className="admin-settings__toggles">
            <SettingsToggle label="Gallery pubblica" description="Rende visibili gallery e media approvati sul sito pubblico." checked={settings.galleryEnabled} disabled={busy || settingsLoading} onChange={(galleryEnabled) => setSettings((current) => ({ ...current, galleryEnabled }))} />
            <SettingsToggle label="Gallery preview Home" description="Mostra nella Home una selezione automatica dei media approvati." checked={settings.galleryPreviewEnabled} disabled={busy || settingsLoading} onChange={(galleryPreviewEnabled) => setSettings((current) => ({ ...current, galleryPreviewEnabled }))} />
            <SettingsToggle label="Download originali" description="Permetti agli invitati di scaricare le foto originali dalla gallery." checked={settings.galleryDownloadEnabled} disabled={busy || settingsLoading} onChange={(galleryDownloadEnabled) => setSettings((current) => ({ ...current, galleryDownloadEnabled }))} />
            <SettingsToggle label="Upload invitati" description="Consente agli invitati di caricare foto e video dalla pagina Foto." checked={settings.guestUploadsEnabled} disabled={busy || settingsLoading} onChange={(guestUploadsEnabled) => setSettings((current) => ({ ...current, guestUploadsEnabled }))} />
            <SettingsToggle label="Richiedi approvazione upload" description="Se attivo, i contenuti degli invitati devono essere approvati prima di comparire nella gallery." checked={settings.requireGuestApproval} disabled={busy || settingsLoading} onChange={(requireGuestApproval) => setSettings((current) => ({ ...current, requireGuestApproval }))} />
            <SettingsToggle label="Auto-approva Photobooth" description="Predispone l'approvazione automatica dei futuri media provenienti dal Photobooth." checked={settings.photoboothAutoApprove} disabled={busy || settingsLoading} onChange={(photoboothAutoApprove) => setSettings((current) => ({ ...current, photoboothAutoApprove }))} />
            <SettingsToggle label="Sezione programma" description="Mostra il programma attivo sul sito pubblico." checked={settings.scheduleEnabled} disabled={busy || settingsLoading} onChange={(scheduleEnabled) => setSettings((current) => ({ ...current, scheduleEnabled }))} />
            <SettingsToggle label="Sezione location" description="Mostra le location attive sul sito pubblico." checked={settings.locationsEnabled} disabled={busy || settingsLoading} onChange={(locationsEnabled) => setSettings((current) => ({ ...current, locationsEnabled }))} />
            <SettingsToggle label="Sezione info" description="Mostra le informazioni utili attive sul sito pubblico." checked={settings.infoEnabled} disabled={busy || settingsLoading} onChange={(infoEnabled) => setSettings((current) => ({ ...current, infoEnabled }))} />
          </div>
          <div className="admin-danger-zone">
            <p>Zona pericolosa</p><h3>Elimina tutti i media</h3>
            <span>Elimina originali, thumbnail, preview e record del matrimonio corrente. Wedding e impostazioni restano invariati.</span>
            <label>Digita <strong>ELIMINA TUTTO</strong> per confermare<input value={deleteAllConfirmation} onChange={(event) => setDeleteAllConfirmation(event.target.value)} autoComplete="off" /></label>
            <button type="button" className="admin-danger" disabled={busy || deleteAllConfirmation !== 'ELIMINA TUTTO'} onClick={() => void deleteAll()}>Elimina tutti i media</button>
          </div>
        </section>
      )}
    </main>
  );
}
