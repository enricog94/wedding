import { FormEvent, useCallback, useEffect, useState } from 'react';
import { adminFetch } from './adminApi';

type Section = 'overview' | 'phases' | 'missions' | 'predictions';
type PhaseStatus = 'locked' | 'active' | 'completed';

type Phase = {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  status: PhaseStatus;
  missionCount: number;
};

type Mission = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  missionType: string;
  points: number;
  active: boolean;
  sortOrder: number;
  phaseId: number;
  phaseName: string;
  phaseStatus: PhaseStatus;
  opensAt: string | null;
  closesAt: string | null;
  effectiveStatus: 'inactive' | 'scheduled' | 'available' | 'expired';
  completionCount: number;
};

type Overview = {
  activePlayers: number;
  activeMissions: number;
  completions: number;
  activePhases: number;
  teamPoints: { bride: number; groom: number };
};

type MissionDraft = {
  id: number | null;
  code: string;
  title: string;
  description: string;
  missionType: 'action' | 'social' | 'photo';
  points: number;
  active: boolean;
  sortOrder: number;
  phaseId: number;
  opensAt: string;
  closesAt: string;
};

type PredictionStatus = 'draft' | 'open' | 'closed' | 'resolved';
type PredictionOption = { id?: number; code: string; label: string; sortOrder: number };
type Prediction = {
  id: number; code: string; question: string; description: string | null;
  points: number; status: PredictionStatus; sortOrder: number;
  effectiveStatus: 'draft' | 'scheduled' | 'open' | 'closed' | 'resolved';
  opensAt: string | null; closesAt: string | null;
  phaseId: number | null; phaseName: string | null; correctOptionId: number | null;
  responseCount: number; options: Array<Required<PredictionOption>>;
  pointsAwardedTotal: number;
};
type PredictionDraft = {
  id: number | null; code: string; question: string; description: string;
  points: number; sortOrder: number; phaseId: number | null;
  opensAt: string; closesAt: string; options: PredictionOption[];
};

const emptyDraft: MissionDraft = {
  id: null,
  code: '',
  title: '',
  description: '',
  missionType: 'action',
  points: 20,
  active: true,
  sortOrder: 0,
  phaseId: 0,
  opensAt: '',
  closesAt: '',
};

const emptyPredictionDraft: PredictionDraft = {
  id: null, code: '', question: '', description: '', points: 20, sortOrder: 0,
  phaseId: null, opensAt: '', closesAt: '',
  options: [
    { code: 'a', label: '', sortOrder: 0 },
    { code: 'b', label: '', sortOrder: 1 },
  ],
};

const predictionStatusLabels: Record<Prediction['effectiveStatus'], string> = {
  draft: 'BOZZA', scheduled: 'PROGRAMMATO', open: 'APERTO ORA', closed: 'CHIUSO', resolved: 'RISOLTO',
};

const missionStatusLabels: Record<Mission['effectiveStatus'], string> = {
  inactive: 'NON ATTIVA',
  scheduled: 'PROGRAMMATA',
  available: 'DISPONIBILE',
  expired: 'SCADUTA',
};

function adminPredictionTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value))
    : '—';
}

function adminPredictionTiming(prediction: Prediction): string {
  if (prediction.effectiveStatus === 'scheduled') return `Apre alle ${adminPredictionTime(prediction.opensAt)}`;
  if (prediction.effectiveStatus === 'open' && prediction.closesAt) return `Chiude alle ${adminPredictionTime(prediction.closesAt)}`;
  if (prediction.effectiveStatus === 'closed' && prediction.status === 'closed') return 'Chiuso manualmente';
  if (prediction.effectiveStatus === 'closed' && prediction.closesAt) return `Chiuso alle ${adminPredictionTime(prediction.closesAt)}`;
  return prediction.code;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await adminFetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function AdminFantasposi() {
  const [section, setSection] = useState<Section>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [draft, setDraft] = useState<MissionDraft>(emptyDraft);
  const [predictionDraft, setPredictionDraft] = useState<PredictionDraft>(emptyPredictionDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [overviewResult, phasesResult, missionsResult, predictionsResult] = await Promise.all([
        api<Overview>('/api/admin/fantasposi/overview'),
        api<{ phases: Phase[] }>('/api/admin/fantasposi/phases'),
        api<{ missions: Mission[] }>('/api/admin/fantasposi/missions'),
        api<{ predictions: Prediction[] }>('/api/admin/fantasposi/predictions'),
      ]);
      setOverview(overviewResult);
      setPhases(phasesResult.phases);
      setMissions(missionsResult.missions);
      setPredictions(predictionsResult.predictions);
      setDraft((current) => current.phaseId || phasesResult.phases.length === 0
        ? current
        : { ...current, phaseId: phasesResult.phases[0].id });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'FantaSposi admin non disponibile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const updatePhase = async (phase: Phase) => {
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`/api/admin/fantasposi/phases/${phase.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: phase.name, sortOrder: phase.sortOrder, status: phase.status }),
      });
      setFeedback('Fase aggiornata. L’eventuale fase attiva precedente è stata completata.');
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Aggiornamento fase non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const saveMission = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setFeedback('');
    try {
      const url = draft.id
        ? `/api/admin/fantasposi/missions/${draft.id}`
        : '/api/admin/fantasposi/missions';
      await api(url, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          opensAt: draft.opensAt ? new Date(draft.opensAt).toISOString() : null,
          closesAt: draft.closesAt ? new Date(draft.closesAt).toISOString() : null,
        }),
      });
      setFeedback(draft.id ? 'Missione aggiornata.' : 'Missione creata.');
      setDraft({ ...emptyDraft, phaseId: phases[0]?.id ?? 0 });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio missione non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const editMission = (mission: Mission) => {
    if (mission.missionType !== 'action' && mission.missionType !== 'social' && mission.missionType !== 'photo') {
      setError(`Il tipo ${mission.missionType} non è ancora modificabile in Mission Engine V1.`);
      return;
    }
    setDraft({
      id: mission.id,
      code: mission.code,
      title: mission.title,
      description: mission.description ?? '',
      missionType: mission.missionType,
      points: mission.points,
      active: mission.active,
      sortOrder: mission.sortOrder,
      phaseId: mission.phaseId,
      opensAt: mission.opensAt?.slice(0, 16) ?? '',
      closesAt: mission.closesAt?.slice(0, 16) ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteMission = async (mission: Mission) => {
    if (!window.confirm(`Eliminare la missione “${mission.title}”?`)) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`/api/admin/fantasposi/missions/${mission.id}`, { method: 'DELETE' });
      setFeedback('Missione eliminata.');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Eliminazione missione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  const setMissionActive = async (mission: Mission, active: boolean) => {
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`/api/admin/fantasposi/missions/${mission.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: mission.code,
          phaseId: mission.phaseId,
          title: mission.title,
          description: mission.description,
          missionType: mission.missionType,
          points: mission.points,
          active,
          sortOrder: mission.sortOrder,
          opensAt: mission.opensAt,
          closesAt: mission.closesAt,
        }),
      });
      setFeedback(active ? 'Missione riattivata.' : 'Missione disattivata.');
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Aggiornamento missione non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const savePrediction = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setFeedback('');
    try {
      await api(predictionDraft.id
        ? `/api/admin/fantasposi/predictions/${predictionDraft.id}`
        : '/api/admin/fantasposi/predictions', {
        method: predictionDraft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...predictionDraft,
          opensAt: predictionDraft.opensAt ? new Date(predictionDraft.opensAt).toISOString() : null,
          closesAt: predictionDraft.closesAt ? new Date(predictionDraft.closesAt).toISOString() : null,
        }),
      });
      setFeedback(predictionDraft.id ? 'Pronostico aggiornato.' : 'Pronostico creato in bozza.');
      setPredictionDraft(emptyPredictionDraft);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio pronostico non riuscito.');
    } finally { setBusy(false); }
  };

  const editPrediction = (prediction: Prediction) => {
    setPredictionDraft({
      id: prediction.id, code: prediction.code, question: prediction.question,
      description: prediction.description ?? '', points: prediction.points,
      sortOrder: prediction.sortOrder, phaseId: prediction.phaseId,
      opensAt: prediction.opensAt?.slice(0, 16) ?? '',
      closesAt: prediction.closesAt?.slice(0, 16) ?? '',
      options: prediction.options.map(({ code, label, sortOrder }) => ({ code, label, sortOrder })),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const predictionAction = async (prediction: Prediction, action: 'open' | 'close' | 'resolve') => {
    let body: string | undefined;
    if (action === 'resolve') {
      const selected = window.prompt(
        `Inserisci il codice della risposta corretta (${prediction.options.map((option) => option.code).join(', ')}):`,
      )?.trim().toLowerCase();
      if (!selected) return;
      const option = prediction.options.find((entry) => entry.code === selected);
      if (!option) { setError('Codice opzione non valido.'); return; }
      body = JSON.stringify({ correctOptionId: option.id });
    }
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`/api/admin/fantasposi/predictions/${prediction.id}/${action}`, {
        method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}),
      });
      setFeedback(action === 'open' ? 'Pronostico aperto.' : action === 'close' ? 'Pronostico chiuso.' : 'Pronostico risolto e punti congelati.');
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Operazione non riuscita.');
    } finally { setBusy(false); }
  };

  const deletePrediction = async (prediction: Prediction) => {
    if (!window.confirm(`Eliminare il pronostico “${prediction.question}”?`)) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`/api/admin/fantasposi/predictions/${prediction.id}`, { method: 'DELETE' });
      setFeedback('Pronostico eliminato.'); await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Eliminazione pronostico non riuscita.');
    } finally { setBusy(false); }
  };

  return (
    <section className="admin-fantasposi" aria-labelledby="admin-fantasposi-title">
      <header className="admin-fantasposi__heading"><div><p>Gioco invitati</p><h2 id="admin-fantasposi-title">FantaSposi</h2></div><button type="button" disabled={busy || loading} onClick={() => void load()}>Aggiorna</button></header>
      <nav className="admin-fantasposi__tabs" aria-label="Gestione FantaSposi">
        <button type="button" className={section === 'overview' ? 'is-active' : ''} onClick={() => setSection('overview')}>Panoramica</button>
        <button type="button" className={section === 'phases' ? 'is-active' : ''} onClick={() => setSection('phases')}>Fasi</button>
        <button type="button" className={section === 'missions' ? 'is-active' : ''} onClick={() => setSection('missions')}>Missioni</button>
        <button type="button" className={section === 'predictions' ? 'is-active' : ''} onClick={() => setSection('predictions')}>Pronostici</button>
      </nav>
      {error && <p className="admin-state admin-state--error" role="alert">{error}</p>}
      {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
      {loading && <p className="admin-state">Caricamento FantaSposi…</p>}

      {!loading && section === 'overview' && overview && <div className="admin-fantasposi__overview">{[
        ['Giocatori attivi', overview.activePlayers],
        ['Missioni attive', overview.activeMissions],
        ['Completamenti', overview.completions],
        ['Fasi attive', overview.activePhases],
        ['Punti Team sposa', overview.teamPoints.bride],
        ['Punti Team sposo', overview.teamPoints.groom],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}

      {!loading && section === 'phases' && <div className="admin-fantasposi__phases">{phases.map((phase) => <article key={phase.id}><div><span>{phase.code}</span><strong>{phase.missionCount} missioni</strong></div><label>Nome<input value={phase.name} onChange={(event) => setPhases((current) => current.map((item) => item.id === phase.id ? { ...item, name: event.target.value } : item))} /></label><label>Ordine<input type="number" min="0" value={phase.sortOrder} onChange={(event) => setPhases((current) => current.map((item) => item.id === phase.id ? { ...item, sortOrder: Number(event.target.value) } : item))} /></label><label>Stato<select value={phase.status} onChange={(event) => setPhases((current) => current.map((item) => item.id === phase.id ? { ...item, status: event.target.value as PhaseStatus } : item))}><option value="locked">Locked</option><option value="active">Active</option><option value="completed">Completed</option></select></label><button type="button" disabled={busy} onClick={() => void updatePhase(phase)}>Salva fase</button></article>)}</div>}

      {!loading && section === 'missions' && <>
        <form className="admin-fantasposi__mission-form" onSubmit={saveMission}>
          <h3>{draft.id ? 'Modifica missione' : 'Nuova missione'}</h3>
          <fieldset className="admin-fantasposi__form-section">
            <legend>Dati missione</legend>
            <label>Codice<input required pattern="[a-z0-9][a-z0-9-]{1,79}" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} /></label>
            <label>Titolo<input required minLength={2} maxLength={140} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Descrizione<textarea maxLength={1000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
            <div>
              <label>Fase<select required value={draft.phaseId} onChange={(event) => setDraft((current) => ({ ...current, phaseId: Number(event.target.value) }))}>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label>
              <label>Tipo<select value={draft.missionType} onChange={(event) => setDraft((current) => ({ ...current, missionType: event.target.value as MissionDraft['missionType'] }))}><option value="action">Action</option><option value="social">Social</option><option value="photo">Photo</option></select></label>
              <label>Punti<input type="number" min="0" max="10000" value={draft.points} onChange={(event) => setDraft((current) => ({ ...current, points: Number(event.target.value) }))} /></label>
              <label>Ordine<input type="number" min="0" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
            </div>
            <label className="admin-fantasposi__check"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /> Missione attiva</label>
          </fieldset>
          <fieldset className="admin-fantasposi__form-section">
            <legend>Programmazione live <span>opzionale</span></legend>
            <p>Lascia entrambi i campi vuoti per una missione disponibile per tutta la fase attiva.</p>
            <div>
              <label>Apre alle (opzionale)<input type="datetime-local" value={draft.opensAt} onChange={(event) => setDraft((current) => ({ ...current, opensAt: event.target.value }))} /></label>
              <label>Chiude alle (opzionale)<input type="datetime-local" value={draft.closesAt} onChange={(event) => setDraft((current) => ({ ...current, closesAt: event.target.value }))} /></label>
            </div>
          </fieldset>
          <div><button type="submit" disabled={busy || phases.length === 0}>{draft.id ? 'Salva modifiche' : 'Crea missione'}</button>{draft.id && <button type="button" disabled={busy} onClick={() => setDraft({ ...emptyDraft, phaseId: phases[0]?.id ?? 0 })}>Annulla</button>}</div>
        </form>
        <div className="admin-fantasposi__missions">{missions.map((mission) => {
          const supported = mission.missionType === 'action' || mission.missionType === 'social' || mission.missionType === 'photo';
          return <article key={mission.id}>
            <div><span>{mission.phaseName} · {mission.missionType === 'photo' ? 'Photo' : mission.missionType}{supported ? '' : ' · non supportata'}</span><strong className={`admin-fantasposi__status is-${mission.effectiveStatus}`}>{missionStatusLabels[mission.effectiveStatus]}</strong></div>
            <h3>{mission.title}</h3>
            {mission.description && <p>{mission.description}</p>}
            <dl className="admin-fantasposi__prediction-meta">
              <div><dt>Apertura</dt><dd>{adminPredictionTime(mission.opensAt)}</dd></div>
              <div><dt>Chiusura</dt><dd>{adminPredictionTime(mission.closesAt)}</dd></div>
              <div><dt>Completamenti</dt><dd>{mission.completionCount}</dd></div>
            </dl>
            <small>{mission.code} · {mission.points} punti · ordine {mission.sortOrder}</small>
            <div><button type="button" disabled={busy || !supported} title={!supported ? 'Tipo non ancora supportato in V1' : 'Modifica dati e programmazione'} onClick={() => editMission(mission)}>Modifica</button><button type="button" disabled={busy || !supported} title={mission.active ? 'Nasconde la missione senza eliminarla' : 'Rende nuovamente attiva la missione'} onClick={() => void setMissionActive(mission, !mission.active)}>{mission.active ? 'Disattiva' : 'Riattiva'}</button><button className="admin-danger" type="button" disabled={busy || mission.completionCount > 0} title={mission.completionCount > 0 ? 'Non eliminabile: esistono completamenti associati' : 'Elimina definitivamente la missione'} onClick={() => void deleteMission(mission)}>Elimina</button></div>
          </article>;
        })}</div>
      </>}

      {!loading && section === 'predictions' && <><form className="admin-fantasposi__mission-form admin-fantasposi__prediction-form" onSubmit={savePrediction}><h3>{predictionDraft.id ? 'Modifica pronostico' : 'Nuovo pronostico'}</h3><label>Codice<input required pattern="[a-z0-9][a-z0-9-]{1,79}" value={predictionDraft.code} onChange={(event) => setPredictionDraft((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} /></label><label>Domanda<input required minLength={3} maxLength={240} value={predictionDraft.question} onChange={(event) => setPredictionDraft((current) => ({ ...current, question: event.target.value }))} /></label><label>Descrizione<textarea maxLength={1500} value={predictionDraft.description} onChange={(event) => setPredictionDraft((current) => ({ ...current, description: event.target.value }))} /></label><div><label>Fase<select value={predictionDraft.phaseId ?? ''} onChange={(event) => setPredictionDraft((current) => ({ ...current, phaseId: event.target.value ? Number(event.target.value) : null }))}><option value="">Globale</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label><label>Punti<input type="number" min="0" max="10000" value={predictionDraft.points} onChange={(event) => setPredictionDraft((current) => ({ ...current, points: Number(event.target.value) }))} /></label><label>Ordine<input type="number" min="0" value={predictionDraft.sortOrder} onChange={(event) => setPredictionDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label></div><div className="admin-fantasposi__optional-time"><p>Programmazione opzionale · lascia vuoto per apertura manuale.</p><label>Apre alle (opzionale)<input type="datetime-local" value={predictionDraft.opensAt} onChange={(event) => setPredictionDraft((current) => ({ ...current, opensAt: event.target.value }))} /></label><label>Chiude alle (opzionale)<input type="datetime-local" value={predictionDraft.closesAt} onChange={(event) => setPredictionDraft((current) => ({ ...current, closesAt: event.target.value }))} /></label></div><fieldset><legend>Opzioni</legend>{predictionDraft.options.map((option, index) => <div key={index}><input aria-label={`Codice opzione ${index + 1}`} required maxLength={20} value={option.code} onChange={(event) => setPredictionDraft((current) => ({ ...current, options: current.options.map((entry, optionIndex) => optionIndex === index ? { ...entry, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') } : entry) }))} /><input aria-label={`Testo opzione ${index + 1}`} required maxLength={160} value={option.label} onChange={(event) => setPredictionDraft((current) => ({ ...current, options: current.options.map((entry, optionIndex) => optionIndex === index ? { ...entry, label: event.target.value } : entry) }))} />{predictionDraft.options.length > 2 && <button type="button" onClick={() => setPredictionDraft((current) => ({ ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index).map((entry, optionIndex) => ({ ...entry, sortOrder: optionIndex })) }))}>Rimuovi</button>}</div>)}</fieldset><button type="button" disabled={predictionDraft.options.length >= 12} onClick={() => setPredictionDraft((current) => ({ ...current, options: [...current.options, { code: String.fromCharCode(97 + current.options.length), label: '', sortOrder: current.options.length }] }))}>Aggiungi opzione</button><div><button type="submit" disabled={busy}>{predictionDraft.id ? 'Salva modifiche' : 'Crea bozza'}</button>{predictionDraft.id && <button type="button" onClick={() => setPredictionDraft(emptyPredictionDraft)}>Annulla</button>}</div></form><div className="admin-fantasposi__missions admin-fantasposi__predictions">{predictions.map((prediction) => { const correctOption = prediction.options.find((option) => option.id === prediction.correctOptionId); return <article key={prediction.id}><div><span>{prediction.phaseName ?? 'Globale'} · <b className={`admin-fantasposi__status is-${prediction.effectiveStatus}`}>{predictionStatusLabels[prediction.effectiveStatus]}</b></span><strong>{prediction.points} punti</strong></div><h3>{prediction.question}</h3>{prediction.description && <p>{prediction.description}</p>}<dl className="admin-fantasposi__prediction-meta"><div><dt>Apertura</dt><dd>{adminPredictionTime(prediction.opensAt)}</dd></div><div><dt>Chiusura</dt><dd>{adminPredictionTime(prediction.closesAt)}</dd></div><div><dt>Risposte</dt><dd>{prediction.responseCount}</dd></div>{prediction.effectiveStatus === 'resolved' && <div><dt>Risposta corretta</dt><dd>{correctOption?.label ?? '—'}</dd></div>}{prediction.effectiveStatus === 'resolved' && <div><dt>Punti assegnati</dt><dd>{prediction.pointsAwardedTotal}</dd></div>}</dl><small>{adminPredictionTiming(prediction)} · {prediction.options.map((option) => `${option.code.toUpperCase()}. ${option.label}`).join(' · ')}</small><div>{prediction.status !== 'resolved' && prediction.responseCount === 0 && <button type="button" disabled={busy} onClick={() => editPrediction(prediction)}>Modifica</button>}{prediction.status === 'draft' && <button type="button" disabled={busy} onClick={() => void predictionAction(prediction, 'open')}>Pubblica</button>}{prediction.effectiveStatus === 'open' && <button type="button" disabled={busy} onClick={() => void predictionAction(prediction, 'close')}>Chiudi ora</button>}{prediction.effectiveStatus === 'closed' && <button type="button" disabled={busy} onClick={() => void predictionAction(prediction, 'resolve')}>Risolvi</button>}<button className="admin-danger" type="button" disabled={busy || prediction.responseCount > 0} title={prediction.responseCount > 0 ? 'Non eliminabile: esistono risposte associate' : 'Elimina definitivamente il pronostico'} onClick={() => void deletePrediction(prediction)}>Elimina</button></div></article>; })}</div></>}
    </section>
  );
}
