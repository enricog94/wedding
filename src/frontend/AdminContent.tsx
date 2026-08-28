import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

type ContentTab = 'wedding' | 'schedule' | 'locations' | 'info';

type WeddingForm = {
  brideName: string;
  groomName: string;
  weddingDate: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
};

type ScheduleItem = {
  id: number;
  timeLabel: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  sortOrder: number;
  enabled: boolean;
};

type LocationItem = {
  id: number;
  name: string;
  type: string | null;
  address: string | null;
  mapsUrl: string | null;
  description: string | null;
  sortOrder: number;
  enabled: boolean;
};

type InfoItem = {
  id: number;
  category: string;
  title: string;
  content: string | null;
  sortOrder: number;
  enabled: boolean;
};

type ScheduleDraft = Omit<ScheduleItem, 'id'> & { id?: number };
type LocationDraft = Omit<LocationItem, 'id'> & { id?: number };
type InfoDraft = Omit<InfoItem, 'id'> & { id?: number };

const EMPTY_WEDDING: WeddingForm = {
  brideName: '', groomName: '', weddingDate: '', heroEyebrow: '', heroTitle: '', heroSubtitle: '',
};

const categoryLabels: Record<string, string> = {
  parking: 'Parcheggio', contacts: 'Contatti', dress_code: 'Dress code', transport: 'Navetta / trasporti',
  accommodation: 'Pernottamento', faq: 'FAQ', other: 'Altro',
};

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401 || response.status === 403) {
    throw new Error('La sessione amministratore è scaduta. Ricarica la pagina.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || 'Operazione non riuscita.');
  }
  return response.json() as Promise<T>;
}

function sortItems<T extends { id: number; sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function nextSortOrder(items: Array<{ sortOrder: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10;
}

type EditorActionsProps = {
  busy: boolean;
  onCancel: () => void;
};

function EditorActions({ busy, onCancel }: EditorActionsProps) {
  return (
    <div className="admin-content-form__actions">
      <button type="submit" disabled={busy}>Salva</button>
      <button type="button" disabled={busy} onClick={onCancel}>Annulla</button>
    </div>
  );
}

export function AdminContent() {
  const [tab, setTab] = useState<ContentTab>('wedding');
  const [wedding, setWedding] = useState<WeddingForm>(EMPTY_WEDDING);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [info, setInfo] = useState<InfoItem[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [locationDraft, setLocationDraft] = useState<LocationDraft | null>(null);
  const [infoDraft, setInfoDraft] = useState<InfoDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const loadContent = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [weddingResult, scheduleResult, locationsResult, infoResult] = await Promise.all([
        adminRequest<WeddingForm & { heroEyebrow: string | null; heroTitle: string | null; heroSubtitle: string | null }>('/api/admin/content/wedding'),
        adminRequest<{ schedule: ScheduleItem[] }>('/api/admin/content/schedule'),
        adminRequest<{ locations: LocationItem[] }>('/api/admin/content/locations'),
        adminRequest<{ info: InfoItem[] }>('/api/admin/content/info'),
      ]);
      setWedding({
        ...weddingResult,
        heroEyebrow: weddingResult.heroEyebrow ?? '',
        heroTitle: weddingResult.heroTitle ?? '',
        heroSubtitle: weddingResult.heroSubtitle ?? '',
      });
      setSchedule(sortItems(scheduleResult.schedule));
      setLocations(sortItems(locationsResult.locations));
      setInfo(sortItems(infoResult.info));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare i contenuti.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadContent(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadContent]);

  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setFeedback('');
    try {
      await action();
      setFeedback(message);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  const saveWedding = () => run(async () => {
    const saved = await adminRequest<WeddingForm & { heroEyebrow: string | null; heroTitle: string | null; heroSubtitle: string | null }>(
      '/api/admin/content/wedding',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wedding) },
    );
    setWedding({ ...saved, heroEyebrow: saved.heroEyebrow ?? '', heroTitle: saved.heroTitle ?? '', heroSubtitle: saved.heroSubtitle ?? '' });
  }, 'Dati del matrimonio salvati.');

  const saveSchedule = (draft: ScheduleDraft) => run(async () => {
    await adminRequest<ScheduleItem>(
      draft.id ? `/api/admin/content/schedule/${draft.id}` : '/api/admin/content/schedule',
      { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) },
    );
    setScheduleDraft(null); await loadContent();
  }, 'Programma aggiornato.');

  const saveLocation = (draft: LocationDraft) => run(async () => {
    await adminRequest<LocationItem>(
      draft.id ? `/api/admin/content/locations/${draft.id}` : '/api/admin/content/locations',
      { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) },
    );
    setLocationDraft(null); await loadContent();
  }, 'Location aggiornate.');

  const saveInfo = (draft: InfoDraft) => run(async () => {
    await adminRequest<InfoItem>(
      draft.id ? `/api/admin/content/info/${draft.id}` : '/api/admin/content/info',
      { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) },
    );
    setInfoDraft(null); await loadContent();
  }, 'Info e FAQ aggiornate.');

  const removeItem = (kind: 'schedule' | 'locations' | 'info', id: number, label: string) => {
    if (!window.confirm(`Eliminare definitivamente “${label}”?`)) return;
    void run(async () => {
      await adminRequest<{ deleted: true }>(`/api/admin/content/${kind}/${id}`, { method: 'DELETE' });
      await loadContent();
    }, 'Contenuto eliminato.');
  };

  const moveSchedule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= schedule.length) return;
    const current = schedule[index]; const other = schedule[target];
    void run(async () => {
      await Promise.all([
        adminRequest(`/api/admin/content/schedule/${current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, sortOrder: other.sortOrder }) }),
        adminRequest(`/api/admin/content/schedule/${other.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...other, sortOrder: current.sortOrder }) }),
      ]);
      await loadContent();
    }, 'Ordine del programma aggiornato.');
  };

  const moveLocation = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= locations.length) return;
    const current = locations[index]; const other = locations[target];
    void run(async () => {
      await Promise.all([
        adminRequest(`/api/admin/content/locations/${current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, sortOrder: other.sortOrder }) }),
        adminRequest(`/api/admin/content/locations/${other.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...other, sortOrder: current.sortOrder }) }),
      ]);
      await loadContent();
    }, 'Ordine delle location aggiornato.');
  };

  const moveInfo = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= info.length) return;
    const current = info[index]; const other = info[target];
    void run(async () => {
      await Promise.all([
        adminRequest(`/api/admin/content/info/${current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, sortOrder: other.sortOrder }) }),
        adminRequest(`/api/admin/content/info/${other.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...other, sortOrder: current.sortOrder }) }),
      ]);
      await loadContent();
    }, 'Ordine delle informazioni aggiornato.');
  };

  const tabs = useMemo(() => [
    ['wedding', 'Dati matrimonio'], ['schedule', 'Programma'], ['locations', 'Location'], ['info', 'Info & FAQ'],
  ] as const, []);

  if (loading) return <p className="admin-state">Caricamento contenuti…</p>;

  return (
    <section className="admin-content" aria-labelledby="admin-content-title">
      <div className="admin-settings__heading">
        <div><p>Contenuti pubblici</p><h2 id="admin-content-title">Contenuti</h2></div>
      </div>
      <nav className="admin-content-tabs" aria-label="Tipi di contenuto">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{label}</button>
        ))}
      </nav>
      {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
      {error && <p className="admin-state admin-state--error" role="alert">{error}</p>}

      {tab === 'wedding' && (
        <form className="admin-content-form" onSubmit={(event) => { event.preventDefault(); void saveWedding(); }}>
          <label>Nome sposa<input required maxLength={80} value={wedding.brideName} onChange={(event) => setWedding((current) => ({ ...current, brideName: event.target.value }))} /></label>
          <label>Nome sposo<input required maxLength={80} value={wedding.groomName} onChange={(event) => setWedding((current) => ({ ...current, groomName: event.target.value }))} /></label>
          <label>Data matrimonio<input required type="date" value={wedding.weddingDate} onChange={(event) => setWedding((current) => ({ ...current, weddingDate: event.target.value }))} /></label>
          <label>Dettaglio hero<input maxLength={80} value={wedding.heroEyebrow} onChange={(event) => setWedding((current) => ({ ...current, heroEyebrow: event.target.value }))} /></label>
          <label className="admin-content-form__wide">Titolo hero opzionale<input maxLength={160} value={wedding.heroTitle} onChange={(event) => setWedding((current) => ({ ...current, heroTitle: event.target.value }))} /></label>
          <label className="admin-content-form__wide">Sottotitolo hero<textarea maxLength={300} value={wedding.heroSubtitle} onChange={(event) => setWedding((current) => ({ ...current, heroSubtitle: event.target.value }))} /></label>
          <div className="admin-content-form__actions"><button type="submit" disabled={busy}>Salva dati</button></div>
        </form>
      )}

      {tab === 'schedule' && (
        <CollectionSection title="Programma" addLabel="Aggiungi evento" onAdd={() => setScheduleDraft({ timeLabel: '', title: '', subtitle: null, description: null, sortOrder: nextSortOrder(schedule), enabled: true })}>
          {scheduleDraft && (
            <form className="admin-content-form admin-content-form--editor" onSubmit={(event) => { event.preventDefault(); void saveSchedule(scheduleDraft); }}>
              <label>Orario<input required maxLength={40} value={scheduleDraft.timeLabel} onChange={(event) => setScheduleDraft({ ...scheduleDraft, timeLabel: event.target.value })} /></label>
              <label>Titolo<input required maxLength={120} value={scheduleDraft.title} onChange={(event) => setScheduleDraft({ ...scheduleDraft, title: event.target.value })} /></label>
              <label>Sottotitolo<input maxLength={180} value={scheduleDraft.subtitle ?? ''} onChange={(event) => setScheduleDraft({ ...scheduleDraft, subtitle: event.target.value })} /></label>
              <label>Ordine<input type="number" required value={scheduleDraft.sortOrder} onChange={(event) => setScheduleDraft({ ...scheduleDraft, sortOrder: Number(event.target.value) })} /></label>
              <label className="admin-content-form__wide">Descrizione<textarea maxLength={1200} value={scheduleDraft.description ?? ''} onChange={(event) => setScheduleDraft({ ...scheduleDraft, description: event.target.value })} /></label>
              <label className="admin-content-check"><input type="checkbox" checked={scheduleDraft.enabled} onChange={(event) => setScheduleDraft({ ...scheduleDraft, enabled: event.target.checked })} /> Visibile</label>
              <EditorActions busy={busy} onCancel={() => setScheduleDraft(null)} />
            </form>
          )}
          <ContentList items={schedule} render={(item, index) => ({
            title: `${item.timeLabel} · ${item.title}`, detail: item.subtitle || item.description || 'Nessun dettaglio', enabled: item.enabled,
            onEdit: () => setScheduleDraft({ ...item }), onToggle: () => void saveSchedule({ ...item, enabled: !item.enabled }),
            onUp: index > 0 ? () => moveSchedule(index, -1) : undefined, onDown: index < schedule.length - 1 ? () => moveSchedule(index, 1) : undefined,
            onDelete: () => removeItem('schedule', item.id, item.title),
          })} />
        </CollectionSection>
      )}

      {tab === 'locations' && (
        <CollectionSection title="Location" addLabel="Aggiungi location" onAdd={() => setLocationDraft({ name: '', type: null, address: null, mapsUrl: null, description: null, sortOrder: nextSortOrder(locations), enabled: true })}>
          {locationDraft && (
            <form className="admin-content-form admin-content-form--editor" onSubmit={(event) => { event.preventDefault(); void saveLocation(locationDraft); }}>
              <label>Nome<input required maxLength={160} value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} /></label>
              <label>Tipo<input maxLength={80} value={locationDraft.type ?? ''} onChange={(event) => setLocationDraft({ ...locationDraft, type: event.target.value })} /></label>
              <label className="admin-content-form__wide">Indirizzo<input maxLength={240} value={locationDraft.address ?? ''} onChange={(event) => setLocationDraft({ ...locationDraft, address: event.target.value })} /></label>
              <label className="admin-content-form__wide">Google/Apple Maps URL<input type="url" pattern="https://.*" maxLength={500} value={locationDraft.mapsUrl ?? ''} onChange={(event) => setLocationDraft({ ...locationDraft, mapsUrl: event.target.value })} /></label>
              <label className="admin-content-form__wide">Descrizione<textarea maxLength={1200} value={locationDraft.description ?? ''} onChange={(event) => setLocationDraft({ ...locationDraft, description: event.target.value })} /></label>
              <label>Ordine<input type="number" required value={locationDraft.sortOrder} onChange={(event) => setLocationDraft({ ...locationDraft, sortOrder: Number(event.target.value) })} /></label>
              <label className="admin-content-check"><input type="checkbox" checked={locationDraft.enabled} onChange={(event) => setLocationDraft({ ...locationDraft, enabled: event.target.checked })} /> Visibile</label>
              <EditorActions busy={busy} onCancel={() => setLocationDraft(null)} />
            </form>
          )}
          <ContentList items={locations} render={(item, index) => ({
            title: item.name, detail: item.address || item.type || 'Nessun dettaglio', enabled: item.enabled,
            onEdit: () => setLocationDraft({ ...item }), onToggle: () => void saveLocation({ ...item, enabled: !item.enabled }),
            onUp: index > 0 ? () => moveLocation(index, -1) : undefined, onDown: index < locations.length - 1 ? () => moveLocation(index, 1) : undefined,
            onDelete: () => removeItem('locations', item.id, item.name),
          })} />
        </CollectionSection>
      )}

      {tab === 'info' && (
        <CollectionSection title="Info & FAQ" addLabel="Aggiungi informazione" onAdd={() => setInfoDraft({ category: 'other', title: '', content: null, sortOrder: nextSortOrder(info), enabled: true })}>
          {infoDraft && (
            <form className="admin-content-form admin-content-form--editor" onSubmit={(event) => { event.preventDefault(); void saveInfo(infoDraft); }}>
              <label>Categoria<select value={infoDraft.category} onChange={(event) => setInfoDraft({ ...infoDraft, category: event.target.value })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Titolo<input required maxLength={160} value={infoDraft.title} onChange={(event) => setInfoDraft({ ...infoDraft, title: event.target.value })} /></label>
              <label className="admin-content-form__wide">Contenuto<textarea maxLength={3000} value={infoDraft.content ?? ''} onChange={(event) => setInfoDraft({ ...infoDraft, content: event.target.value })} /></label>
              <label>Ordine<input type="number" required value={infoDraft.sortOrder} onChange={(event) => setInfoDraft({ ...infoDraft, sortOrder: Number(event.target.value) })} /></label>
              <label className="admin-content-check"><input type="checkbox" checked={infoDraft.enabled} onChange={(event) => setInfoDraft({ ...infoDraft, enabled: event.target.checked })} /> Visibile</label>
              <EditorActions busy={busy} onCancel={() => setInfoDraft(null)} />
            </form>
          )}
          <ContentList items={info} render={(item, index) => ({
            title: item.title, detail: `${categoryLabels[item.category] ?? item.category}${item.content ? ` · ${item.content}` : ''}`, enabled: item.enabled,
            onEdit: () => setInfoDraft({ ...item }), onToggle: () => void saveInfo({ ...item, enabled: !item.enabled }),
            onUp: index > 0 ? () => moveInfo(index, -1) : undefined, onDown: index < info.length - 1 ? () => moveInfo(index, 1) : undefined,
            onDelete: () => removeItem('info', item.id, item.title),
          })} />
        </CollectionSection>
      )}
    </section>
  );
}

type CollectionSectionProps = {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
};

function CollectionSection({ title, addLabel, onAdd, children }: CollectionSectionProps) {
  return (
    <section className="admin-content-collection">
      <div className="admin-content-collection__heading"><h3>{title}</h3><button type="button" onClick={onAdd}>+ {addLabel}</button></div>
      {children}
    </section>
  );
}

type ContentListActions = {
  title: string;
  detail: string;
  enabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
};

function ContentList<T extends { id: number }>({ items, render }: { items: T[]; render: (item: T, index: number) => ContentListActions }) {
  if (items.length === 0) return <p className="admin-content-empty">Nessun contenuto inserito.</p>;
  return (
    <div className="admin-content-list">
      {items.map((item, index) => {
        const actions = render(item, index);
        return (
          <article key={item.id}>
            <div><span data-enabled={actions.enabled}>{actions.enabled ? 'Visibile' : 'Nascosto'}</span><h4>{actions.title}</h4><p>{actions.detail}</p></div>
            <div className="admin-content-list__actions">
              <button type="button" onClick={actions.onEdit}>Modifica</button>
              <button type="button" onClick={actions.onToggle}>{actions.enabled ? 'Nascondi' : 'Mostra'}</button>
              <button type="button" disabled={!actions.onUp} onClick={actions.onUp}>Sposta su</button>
              <button type="button" disabled={!actions.onDown} onClick={actions.onDown}>Sposta giù</button>
              <button type="button" className="admin-danger" onClick={actions.onDelete}>Elimina</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
