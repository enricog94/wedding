import { FormEvent, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  configureSupabase,
  getSupabaseAccessToken,
  getSupabaseSession,
  requestSupabaseOtp,
  signOutSupabase,
  startSupabaseOAuth,
  verifySupabaseOtp,
  type SupabasePublicConfig,
} from '../lib/supabase';
import {
  effectiveMissionStatus as getEffectiveMissionStatus,
  effectivePredictionStatus as getEffectivePredictionStatus,
  formatFantasposiCountdown,
  type FantasposiGameState,
} from '../lib/fantasposi-domain';
import {
  useFantasposiClock,
  useFantasposiRealtime,
  type FantasposiInvalidation,
} from './useFantasposiRealtime';

type Team = 'bride' | 'groom';

type FantasyWedding = {
  id: number;
  slug: string;
  brideName: string;
  groomName: string;
  weddingDate: string;
  teams: Record<Team, string>;
};

type FantasyPlayer = {
  id: number;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  team: Team;
  onboardingCompleted: boolean;
  active: boolean;
  joinedAt: string | null;
  points: number;
};

type MeResponse = {
  authenticated: true;
  user: { id: string; email: string | null; displayName: string | null; avatarUrl: string | null };
  wedding: FantasyWedding;
  player: FantasyPlayer | null;
  onboardingCompleted: boolean;
  team: Team | null;
};

type FantasyPhase = {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  status: 'locked' | 'active' | 'completed';
};

type FantasyMission = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  missionType: string;
  points: number;
  active: boolean;
  sortOrder: number;
  opensAt: string | null;
  closesAt: string | null;
  effectiveStatus: 'inactive' | 'scheduled' | 'available' | 'expired' | 'completed';
  phase: { id: number; code: string; name: string; status: string };
  completed: boolean;
  completedAt: string | null;
  pointsAwarded: number | null;
};

type BootstrapResponse = {
  gameState: FantasposiGameState;
  wedding: FantasyWedding;
  player: FantasyPlayer;
  currentPhase: FantasyPhase | null;
  phases: FantasyPhase[];
  featureFlags: {
    missionsLive: boolean;
    predictionsLive: boolean;
    leaderboardLive: boolean;
  };
  totalPoints: number;
  missionPoints: number;
  predictionPoints: number;
  completedMissionCount: number;
  availableMissionCount: number;
  recommendedMissions: FantasyMission[];
  openPredictionCount: number;
  recommendedPredictions: Array<{ id: number; question: string; points: number }>;
  teamPoints: Record<Team, number>;
};

type FantasyPrediction = {
  id: number;
  code: string;
  question: string;
  description: string | null;
  points: number;
  status: 'open' | 'closed' | 'resolved';
  effectiveStatus: 'scheduled' | 'open' | 'closed' | 'resolved';
  opensAt: string | null;
  closesAt: string | null;
  options: Array<{ id: number; code: string; label: string }>;
  selectedOptionId: number | null;
  answered: boolean;
  canAnswer: boolean;
  phaseActive: boolean;
  correctOptionId?: number;
  pointsAwarded: number | null;
};

type PredictionsResponse = { predictions: FantasyPrediction[] };

function effectivePredictionStatus(prediction: FantasyPrediction, now: number) {
  return getEffectivePredictionStatus(prediction, now);
}

function formatPredictionTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function fantasposiCountdown(target: string | null, now: number): string | null {
  return formatFantasposiCountdown(target, now);
}

function effectiveMissionStatus(
  mission: FantasyMission,
  now: number,
): FantasyMission['effectiveStatus'] {
  return getEffectiveMissionStatus({
    active: mission.active,
    phaseStatus: mission.phase.status,
    completed: mission.completed,
    opensAt: mission.opensAt,
    closesAt: mission.closesAt,
  }, now);
}

type MissionsResponse = {
  phases: Array<{
    phase: { id: number; code: string; name: string; status: string };
    missions: FantasyMission[];
  }>;
  totalPoints: number;
  completedMissionCount: number;
  availableMissionCount: number;
};

type LeaderboardResponse = {
  teams: Record<Team, {
    name: string;
    points: number;
    players: number;
  }>;
  players: Array<{
    playerId: number;
    displayName: string;
    team: Team;
    points: number;
    completedMissions: number;
    rank: number;
    isCurrentUser: boolean;
  }>;
  currentPlayer: {
    playerId: number;
    rank: number;
    points: number;
    team: Team;
  } | null;
};

type FantasyState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'onboarding'; me: MeResponse }
  | { status: 'inactive'; me: MeResponse }
  | { status: 'ready'; bootstrap: BootstrapResponse }
  | { status: 'error'; message: string };

async function fantasyFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error('Sessione scaduta. Accedi nuovamente.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? `HTTP ${response.status}`;
}

const PHOTO_PROOF_TYPE_LIST = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;
const PHOTO_PROOF_TYPES = new Set<string>(PHOTO_PROOF_TYPE_LIST);
const PHOTO_PROOF_ACCEPT = PHOTO_PROOF_TYPE_LIST.join(',');
const PHOTO_PROOF_MAX_SIZE = 20 * 1024 * 1024;

function putPhotoProof(
  uploadUrl: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open('PUT', uploadUrl);
    upload.setRequestHeader('Content-Type', file.type);
    upload.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    upload.onload = () => {
      if (upload.status >= 200 && upload.status < 300) resolve();
      else reject(new Error('Caricamento della foto non riuscito.'));
    };
    upload.onerror = () => reject(new Error('Caricamento della foto non riuscito.'));
    upload.onabort = () => reject(new Error('Caricamento della foto annullato.'));
    upload.send(file);
  });
}

function FantasyLogin({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendLocked, setResendLocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [weddingNames, setWeddingNames] = useState<{ brideName: string; groomName: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/wedding/current', { signal: controller.signal })
      .then(async (response): Promise<{ brideName?: string; groomName?: string } | null> => (
        response.ok ? response.json() as Promise<{ brideName?: string; groomName?: string }> : null
      ))
      .then((wedding) => {
        if (wedding?.brideName && wedding.groomName) {
          setWeddingNames({ brideName: wedding.brideName, groomName: wedding.groomName });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!resendLocked) return undefined;
    const timeout = window.setTimeout(() => setResendLocked(false), 60_000);
    return () => window.clearTimeout(timeout);
  }, [resendLocked]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const requestedEmail = email.trim();
      await requestSupabaseOtp(requestedEmail);
      setOtpEmail(requestedEmail);
      setCodeRequested(true);
      setResendLocked(true);
      setNotice(`Abbiamo inviato un codice a ${requestedEmail}. Usa l’ultimo codice ricevuto.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Invio del codice non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await requestSupabaseOtp(otpEmail);
      setCode('');
      setResendLocked(true);
      setNotice(`Nuovo codice inviato a ${otpEmail}. Il codice precedente non è più valido.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Invio del codice non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await verifySupabaseOtp(otpEmail, code);
      await onAuthenticated();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Codice non valido o scaduto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fantasposi-entry">
      <section className="fantasposi-entry__panel" aria-labelledby="fantasposi-login-title">
        <p className="fantasposi-kicker">
          {weddingNames ? <>{weddingNames.brideName} &amp; {weddingNames.groomName} presentano</> : 'Il matrimonio presenta'}
        </p>
        <h1 id="fantasposi-login-title">FantaSposi</h1>
        <p>Missioni, pronostici e sfide live dal primo brindisi fino alla premiazione.</p>
        <button className="fantasposi-secondary" type="button" disabled={busy} onClick={() => startSupabaseOAuth('google', '/fantasposi')}>
          Continua con Google
        </button>
        <div className="fantasposi-entry__separator"><span>oppure</span></div>
        <form onSubmit={codeRequested ? verifyCode : requestCode}>
          <label>
            La tua email
            <input type="email" autoComplete="email" required disabled={busy || codeRequested} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {codeRequested && (
            <label>
              Codice ricevuto
              <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]+" required value={code} onChange={(event) => setCode(event.target.value)} />
            </label>
          )}
          {notice && <p className="fantasposi-notice" role="status">{notice}</p>}
          {error && <p className="fantasposi-error" role="alert">{error}</p>}
          <button className="fantasposi-primary" type="submit" disabled={busy}>{codeRequested ? 'Entra nel gioco' : 'Ricevi il codice'}</button>
          {codeRequested && <button className="fantasposi-text-button" type="button" disabled={busy || resendLocked} onClick={() => void resendCode()}>{resendLocked ? 'Attendi prima di reinviare' : 'Invia di nuovo'}</button>}
          {codeRequested && <button className="fantasposi-text-button" type="button" disabled={busy} onClick={() => { setCodeRequested(false); setOtpEmail(''); setCode(''); setError(''); setNotice(''); }}>Usa un’altra email</button>}
        </form>
      </section>
    </main>
  );
}

function FantasyOnboarding({ me, onCompleted }: { me: MeResponse; onCompleted: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState(me.user.displayName ?? '');
  const [team, setTeam] = useState<Team | null>(me.team);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const complete = async () => {
    if (!team) return;
    setBusy(true); setError('');
    try {
      const response = await fantasyFetch('/api/fantasposi/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), team }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await onCompleted();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'Onboarding non completato.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fantasposi-entry">
      <section className="fantasposi-entry__panel fantasposi-onboarding" aria-live="polite">
        <div className="fantasposi-steps" aria-label={`Passaggio ${step} di 4`}><span style={{ width: `${step * 25}%` }} /></div>
        {step === 1 && <><p className="fantasposi-kicker">Benvenuto a</p><h1>FantaSposi</h1><p>Missioni, pronostici e sfide live dal primo brindisi fino alla premiazione.</p><button className="fantasposi-primary" type="button" onClick={() => setStep(2)}>Cominciamo</button></>}
        {step === 2 && <><p className="fantasposi-kicker">Come ti chiami?</p><h2>Nome visualizzato</h2><p>Sarà il nome che vedranno gli altri giocatori.</p><label className="fantasposi-field">Nome<input autoFocus maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="fantasposi-primary" type="button" disabled={displayName.trim().length < 2} onClick={() => setStep(3)}>Continua</button></>}
        {step === 3 && <><p className="fantasposi-kicker">Da che parte stai?</p><h2>Scegli la squadra</h2><div className="fantasposi-team-choice"><button type="button" className={team === 'bride' ? 'is-selected' : ''} onClick={() => setTeam('bride')}><span>01</span>{me.wedding.teams.bride}</button><button type="button" className={team === 'groom' ? 'is-selected' : ''} onClick={() => setTeam('groom')}><span>02</span>{me.wedding.teams.groom}</button></div><button className="fantasposi-primary" type="button" disabled={!team} onClick={() => setStep(4)}>Continua</button></>}
        {step === 4 && <><p className="fantasposi-kicker">Tutto pronto</p><h2>Ci siamo.</h2><div className="fantasposi-confirm"><span>{displayName.trim()}</span><strong>{team ? me.wedding.teams[team] : ''}</strong></div>{error && <p className="fantasposi-error" role="alert">{error}</p>}<button className="fantasposi-primary" type="button" disabled={busy} onClick={() => void complete()}>{busy ? 'Prepariamo il gioco…' : 'Entra in FantaSposi'}</button></>}
        {step > 1 && !busy && <button className="fantasposi-text-button" type="button" onClick={() => setStep((current) => current - 1)}>Indietro</button>}
      </section>
    </main>
  );
}

const routes = [
  { path: '/fantasposi', label: 'Home', icon: '⌂' },
  { path: '/fantasposi/missioni', label: 'Missioni', icon: '✦' },
  { path: '/fantasposi/pronostici', label: 'Pronostici', icon: '?' },
  { path: '/fantasposi/classifica', label: 'Classifica', icon: '↗' },
  { path: '/fantasposi/profilo', label: 'Profilo', icon: '○' },
] as const;

function FantasyMissions({
  onSummaryChange,
  refreshKey,
  gameState,
}: {
  onSummaryChange: (summary: { totalPoints: number; completedDelta: number; availableDelta: number; missionId: number }) => void;
  refreshKey: number;
  gameState: FantasposiGameState;
}) {
  const [data, setData] = useState<MissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [proofs, setProofs] = useState<Record<number, {
    previewUrl?: string;
    progress: number | null;
    status: 'uploading' | 'completing' | 'completed' | 'error';
    message: string;
  }>>({});
  const proofUrls = useRef<Map<number, string>>(new Map());
  const busyIdRef = useRef<number | null>(null);
  const now = useFantasposiClock(true);

  useEffect(() => () => {
    for (const url of proofUrls.current.values()) URL.revokeObjectURL(url);
    proofUrls.current.clear();
  }, []);

  useEffect(() => {
    let mounted = true;
    fantasyFetch('/api/fantasposi/missions')
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<MissionsResponse>;
      })
      .then((result) => {
        if (mounted) {
          setData(result);
          setError('');
        }
      })
      .catch((loadError: unknown) => { if (mounted) setError(loadError instanceof Error ? loadError.message : 'Missioni non disponibili.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refreshKey]);

  const applyCompletion = (mission: FantasyMission, result: {
    mission: FantasyMission;
    pointsAwarded: number;
    totalPoints: number;
  }) => {
    setData((current) => current ? {
      ...current,
      totalPoints: result.totalPoints,
      completedMissionCount: current.completedMissionCount + (mission.completed ? 0 : 1),
      availableMissionCount: Math.max(0, current.availableMissionCount - (mission.completed ? 0 : 1)),
      phases: current.phases.map((group) => ({
        ...group,
        missions: group.missions.map((item) => item.id === mission.id ? result.mission : item),
      })),
    } : current);
    onSummaryChange({
      totalPoints: result.totalPoints,
      completedDelta: mission.completed ? 0 : 1,
      availableDelta: mission.completed ? 0 : -1,
      missionId: mission.id,
    });
  };

  const complete = async (mission: FantasyMission) => {
    if (gameState !== 'active' || effectiveMissionStatus(mission, now) !== 'available' || busyIdRef.current !== null) return;
    busyIdRef.current = mission.id;
    setBusyId(mission.id); setError('');
    try {
      const response = await fantasyFetch(`/api/fantasposi/missions/${mission.id}/complete`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as {
        mission: FantasyMission;
        pointsAwarded: number;
        totalPoints: number;
      };
      applyCompletion(mission, result);
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'Completamento non riuscito.');
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  };

  const uploadPhotoProof = async (mission: FantasyMission, file: File) => {
    if (gameState !== 'active' || effectiveMissionStatus(mission, now) !== 'available' || busyIdRef.current !== null) return;
    const previousUrl = proofUrls.current.get(mission.id);
    if (!PHOTO_PROOF_TYPES.has(file.type)) {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      proofUrls.current.delete(mission.id);
      setProofs((current) => ({
        ...current,
        [mission.id]: { progress: null, status: 'error', message: 'Seleziona una foto JPEG, PNG, WebP, HEIC o HEIF.' },
      }));
      return;
    }
    if (file.size <= 0 || file.size > PHOTO_PROOF_MAX_SIZE) {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      proofUrls.current.delete(mission.id);
      setProofs((current) => ({
        ...current,
        [mission.id]: { progress: null, status: 'error', message: 'La foto deve essere inferiore a 20 MB.' },
      }));
      return;
    }

    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const previewUrl = URL.createObjectURL(file);
    proofUrls.current.set(mission.id, previewUrl);
    busyIdRef.current = mission.id;
    setBusyId(mission.id); setError('');
    setProofs((current) => ({
      ...current,
      [mission.id]: { previewUrl, progress: 0, status: 'uploading', message: 'Caricamento foto…' },
    }));
    try {
      const createResponse = await fantasyFetch(`/api/fantasposi/missions/${mission.id}/proof/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }),
      });
      if (!createResponse.ok) throw new Error(await responseError(createResponse));
      const upload = await createResponse.json() as { mediaId: number; uploadUrl: string; method: string };
      if (!Number.isSafeInteger(upload.mediaId) || !upload.uploadUrl || upload.method !== 'PUT') {
        throw new Error('Upload proof non valido.');
      }
      await putPhotoProof(upload.uploadUrl, file, (progress) => {
        setProofs((current) => ({
          ...current,
          [mission.id]: { previewUrl, progress, status: 'uploading', message: `Caricamento ${progress}%` },
        }));
      });
      setProofs((current) => ({
        ...current,
        [mission.id]: { previewUrl, progress: 100, status: 'completing', message: 'Registrazione della prova…' },
      }));
      const proofResponse = await fantasyFetch(
        `/api/fantasposi/missions/${mission.id}/proof/${upload.mediaId}/complete`,
        { method: 'POST' },
      );
      if (!proofResponse.ok) throw new Error(await responseError(proofResponse));

      const completionResponse = await fantasyFetch(
        `/api/fantasposi/missions/${mission.id}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mediaId: upload.mediaId }),
        },
      );
      if (!completionResponse.ok) throw new Error(await responseError(completionResponse));
      const result = await completionResponse.json() as {
        mission: FantasyMission;
        pointsAwarded: number;
        totalPoints: number;
      };
      applyCompletion(mission, result);
      setProofs((current) => ({
        ...current,
        [mission.id]: {
          previewUrl, progress: 100, status: 'completed',
          message: `✓ Missione completata · +${result.pointsAwarded} punti`,
        },
      }));
    } catch (uploadError) {
      setProofs((current) => ({
        ...current,
        [mission.id]: {
          previewUrl, progress: null, status: 'error',
          message: uploadError instanceof Error ? uploadError.message : 'Caricamento della prova non riuscito.',
        },
      }));
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  };

  const selectPhotoProof = (mission: FantasyMission, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void uploadPhotoProof(mission, file);
  };

  if (loading) return <section className="fantasposi-placeholder"><p>Caricamento missioni…</p></section>;
  const missionCount = data?.phases.reduce((total, group) => total + group.missions.length, 0) ?? 0;
  return (
    <section className="fantasposi-missions">
      <p className="fantasposi-kicker">Fase attuale</p>
      <h1>{data?.phases[0]?.phase.name ?? 'In preparazione'}</h1>
      {gameState !== 'active' && <p className="fantasposi-notice">{gameState === 'finished' ? 'Il gioco è concluso: i completamenti sono congelati.' : 'Il gioco non è ancora iniziato.'}</p>}
      {error && <p className="fantasposi-error" role="alert">{error}</p>}
      {missionCount === 0 && <div className="fantasposi-missions__empty"><span aria-hidden="true">✦</span><p>Le missioni saranno disponibili quando inizierà la prossima fase.</p></div>}
      <div className="fantasposi-mission-list">
        {data?.phases.flatMap((group) => group.missions).map((mission) => {
          const effectiveStatus = effectiveMissionStatus(mission, now);
          const timing = effectiveStatus === 'scheduled'
            ? `Si sblocca tra ${fantasposiCountdown(mission.opensAt, now) ?? ''}`
            : effectiveStatus === 'available' && mission.closesAt
              ? `Chiude tra ${fantasposiCountdown(mission.closesAt, now) ?? ''}`
              : effectiveStatus === 'expired' ? 'Tempo scaduto' : null;
          return (
          <article className={`fantasposi-mission is-${effectiveStatus}`} key={mission.id}>
            <div><p>{mission.missionType === 'photo' ? 'Missione foto' : mission.missionType === 'social' ? 'Missione social' : 'Missione action'}</p><strong>+{mission.points} punti</strong></div>
            <h2>{mission.title}</h2>
            {mission.description && <p>{mission.description}</p>}
            {timing && <p className="fantasposi-mission__timing">{timing}</p>}
            {gameState === 'active' && mission.missionType === 'photo' && effectiveStatus === 'available' ? (
              <label className={`fantasposi-mission__photo-button${busyId !== null ? ' is-disabled' : ''}`}>
                {busyId === mission.id ? 'Caricamento…' : 'Scatta o carica una foto'}
                <input type="file" accept={PHOTO_PROOF_ACCEPT} disabled={busyId !== null} onChange={(event) => selectPhotoProof(mission, event)} />
              </label>
            ) : (
              <button type="button" disabled={gameState !== 'active' || effectiveStatus !== 'available' || busyId !== null} onClick={() => void complete(mission)}>
                {effectiveStatus === 'completed' ? '✓ Completata'
                  : effectiveStatus === 'scheduled' ? 'Non ancora disponibile'
                    : effectiveStatus === 'expired' ? 'Missione scaduta'
                      : busyId === mission.id ? 'Completamento…' : 'Missione completata'}
              </button>
            )}
            {proofs[mission.id] && (
              <div className={`fantasposi-mission__proof is-${proofs[mission.id].status}${proofs[mission.id].previewUrl ? ' has-preview' : ''}`} aria-live="polite">
                {proofs[mission.id].previewUrl && <img src={proofs[mission.id].previewUrl} alt="Anteprima della prova selezionata" />}
                <span>{proofs[mission.id].message}</span>
                {proofs[mission.id].status === 'uploading' && proofs[mission.id].progress !== null
                  && <progress aria-label="Avanzamento caricamento foto" max="100" value={proofs[mission.id].progress ?? 0} />}
              </div>
            )}
            {mission.completed && <small>+{mission.pointsAwarded ?? mission.points} punti conquistati</small>}
          </article>
          );
        })}
      </div>
    </section>
  );
}

function FantasyLeaderboard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    fantasyFetch('/api/fantasposi/leaderboard')
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<LeaderboardResponse>;
      })
      .then((result) => { if (mounted) setData(result); })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Classifica non disponibile.');
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refreshKey]);

  if (loading) return <section className="fantasposi-placeholder"><p>Caricamento classifica…</p></section>;
  if (error) return <section className="fantasposi-placeholder"><p className="fantasposi-error" role="alert">{error}</p></section>;
  if (!data) return null;

  return (
    <section className="fantasposi-leaderboard">
      <p className="fantasposi-kicker">FantaSposi</p>
      <h1>Classifica</h1>
      <div className="fantasposi-team-score" aria-label="Punteggio squadre">
        {(['bride', 'groom'] as const).map((team) => (
          <article key={team}>
            <span>Team {data.teams[team].name}</span>
            <strong>{data.teams[team].points}</strong>
            <small>{data.teams[team].players} {data.teams[team].players === 1 ? 'giocatore' : 'giocatori'}</small>
          </article>
        ))}
        <span className="fantasposi-team-score__versus" aria-hidden="true">VS</span>
      </div>
      <div className="fantasposi-leaderboard__heading">
        <h2>Classifica generale</h2>
        {data.currentPlayer && <span>Tu sei {data.currentPlayer.rank}°</span>}
      </div>
      {data.players.length > 0 ? (
        <ol className="fantasposi-ranking">
          {data.players.map((player) => (
            <li key={player.playerId} className={player.isCurrentUser ? 'is-current' : ''}>
              <span className="fantasposi-ranking__position" aria-label={`Posizione ${player.rank}`}>{player.rank}</span>
              <div>
                <strong>{player.displayName}{player.isCurrentUser ? ' · Tu' : ''}</strong>
                <small>Team {data.teams[player.team].name} · {player.completedMissions} {player.completedMissions === 1 ? 'missione' : 'missioni'}</small>
              </div>
              <b>{player.points} <small>pt</small></b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fantasposi-leaderboard__empty">La classifica non contiene ancora giocatori attivi.</p>
      )}
    </section>
  );
}

function FantasyPredictions({ refreshKey, gameState }: { refreshKey: number; gameState: FantasposiGameState }) {
  const [data, setData] = useState<PredictionsResponse | null>(null);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const now = useFantasposiClock(true);

  const load = useCallback(async () => {
    console.info('[FantaRealtime] refetch predictions');
    const response = await fantasyFetch('/api/fantasposi/predictions');
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json() as PredictionsResponse;
    setData(result);
    setChoices(Object.fromEntries(result.predictions
      .filter((prediction) => prediction.selectedOptionId !== null)
      .map((prediction) => [prediction.id, prediction.selectedOptionId as number])));
  }, []);

  useEffect(() => {
    let mounted = true;
    const timeout = window.setTimeout(() => {
      void load().catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Pronostici non disponibili.');
      }).finally(() => { if (mounted) setLoading(false); });
    }, 0);
    return () => { mounted = false; window.clearTimeout(timeout); };
  }, [load, refreshKey]);

  const answer = async (prediction: FantasyPrediction) => {
    const optionId = choices[prediction.id];
    const effectiveStatus = effectivePredictionStatus(prediction, now);
    if (gameState !== 'active' || !optionId || effectiveStatus !== 'open' || !prediction.phaseActive) return;
    setBusyId(prediction.id); setError('');
    try {
      const response = await fantasyFetch(`/api/fantasposi/predictions/${prediction.id}/answer`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionId }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string; code?: string; answeredAt?: string;
      } | null;
      if (!response.ok) {
        if (payload?.code === 'prediction_closed') {
          await load();
          throw new Error('Il pronostico si è appena chiuso.');
        }
        if (payload?.code === 'prediction_scheduled') await load();
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      const wasAnswered = prediction.answered;
      const recordedAt = payload?.answeredAt
        ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(payload.answeredAt))
        : null;
      setFeedback((current) => ({
        ...current,
        [prediction.id]: `✓ Risposta ${wasAnswered ? 'aggiornata' : 'registrata'}${recordedAt ? ` alle ${recordedAt}` : ''}`,
      }));
      await load();
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : 'Risposta non salvata.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <section className="fantasposi-placeholder"><p>Caricamento pronostici…</p></section>;
  return <section className="fantasposi-predictions">
    <p className="fantasposi-kicker">Fai la tua scelta</p>
    <h1>Pronostici</h1>
    {error && <p className="fantasposi-error" role="alert">{error}</p>}
    {!data?.predictions.length && <p className="fantasposi-predictions__empty">Non ci sono ancora pronostici disponibili.</p>}
    <div className="fantasposi-prediction-list">{data?.predictions.map((prediction) => {
      const selected = choices[prediction.id] ?? prediction.selectedOptionId;
      const effectiveStatus = effectivePredictionStatus(prediction, now);
      const canAnswer = gameState === 'active' && effectiveStatus === 'open' && prediction.phaseActive;
      const correct = effectiveStatus === 'resolved' && selected === prediction.correctOptionId;
      const timing = effectiveStatus === 'scheduled'
        ? `Apre tra ${fantasposiCountdown(prediction.opensAt, now) ?? ''}`
        : effectiveStatus === 'open' && prediction.closesAt
          ? `Chiude tra ${fantasposiCountdown(prediction.closesAt, now) ?? ''}` : null;
      return <article key={prediction.id} className={`fantasposi-prediction is-${effectiveStatus}`}>
        <div><span>{effectiveStatus === 'scheduled' ? 'Programmato' : effectiveStatus === 'open' ? 'Aperto' : effectiveStatus === 'closed' ? 'Chiuso' : 'Risultato'}</span><strong>+{prediction.points} punti</strong></div>
        <h2>{prediction.question}</h2>
        {prediction.description && <p>{prediction.description}</p>}
        {timing && <p className="fantasposi-prediction__timing">{timing}</p>}
        <fieldset disabled={!canAnswer || busyId !== null}>
          <legend className="sr-only">Scegli una risposta</legend>
          {prediction.options.map((option) => <label key={option.id} className={selected === option.id ? 'is-selected' : ''}>
            <input type="radio" name={`prediction-${prediction.id}`} checked={selected === option.id}
              onChange={() => setChoices((current) => ({ ...current, [prediction.id]: option.id }))} />
            <span>{option.code.toUpperCase()}</span>{option.label}
            {effectiveStatus === 'resolved' && prediction.correctOptionId === option.id && <b>Corretta</b>}
          </label>)}
        </fieldset>
        {canAnswer
          ? <button type="button" disabled={!selected || busyId !== null} onClick={() => void answer(prediction)}>{busyId === prediction.id ? 'Salvataggio…' : prediction.answered ? 'Modifica risposta' : 'Conferma'}</button>
          : effectiveStatus === 'resolved'
            ? <p className={`fantasposi-prediction__result ${correct ? 'is-correct' : ''}`}>{correct ? `Risposta corretta · +${prediction.pointsAwarded ?? 0} punti` : 'Risposta errata · 0 punti'}</p>
            : effectiveStatus === 'scheduled'
              ? <p className="fantasposi-prediction__result">Apre alle {formatPredictionTime(prediction.opensAt)}</p>
              : <p className="fantasposi-prediction__result">Pronostico chiuso</p>}
        {feedback[prediction.id] && <p className="fantasposi-notice" role="status">{feedback[prediction.id]}</p>}
      </article>;
    })}</div>
  </section>;
}

function FantasyHowToPlay({ onBack }: { onBack: () => void }) {
  const steps = [
    ['01', 'Scegli il team', 'Entra nel Team sposa o nel Team sposo.'],
    ['02', 'Completa le missioni', 'Segui le sfide disponibili nella fase corrente.'],
    ['03', 'Fai i pronostici', 'Scegli la risposta prima della chiusura.'],
    ['04', 'Accumula punti', 'Ogni missione o pronostico assegna punti una sola volta.'],
    ['05', 'Segui la classifica', 'Controlla la tua posizione e il risultato delle squadre.'],
  ];
  return <section className="fantasposi-how-to">
    <p className="fantasposi-kicker">Regole essenziali</p>
    <h1>Come si gioca</h1>
    <p>Il gioco accompagna le diverse fasi dell’evento: alcune sfide sono live e a tempo, altre richiedono una foto come prova.</p>
    <ol>{steps.map(([number, title, description]) => <li key={number}><span>{number}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol>
    <button className="fantasposi-secondary" type="button" onClick={onBack}>Torna al profilo</button>
  </section>;
}

function FantasyFinalResults({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    fantasyFetch('/api/fantasposi/leaderboard')
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<LeaderboardResponse>;
      })
      .then((result) => { if (mounted) setData(result); })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Risultati finali non disponibili.');
      });
    return () => { mounted = false; };
  }, [refreshKey]);
  if (error) return <section className="fantasposi-final"><h1>FantaSposi concluso</h1><p className="fantasposi-error">{error}</p></section>;
  if (!data) return <section className="fantasposi-final"><p>Prepariamo i risultati finali…</p></section>;
  const bridePoints = data.teams.bride.points;
  const groomPoints = data.teams.groom.points;
  const winner = bridePoints === groomPoints
    ? 'Pareggio tra i due team'
    : `Vince il Team ${bridePoints > groomPoints ? data.teams.bride.name : data.teams.groom.name}`;
  return <section className="fantasposi-final">
    <p className="fantasposi-kicker">Risultati finali</p>
    <h1>FantaSposi concluso</h1>
    <p className="fantasposi-final__winner">{winner}</p>
    {data.currentPlayer && <div className="fantasposi-final__personal"><span>La tua posizione</span><strong>{data.currentPlayer.rank}°</strong><span>{data.currentPlayer.points} punti · Team {data.teams[data.currentPlayer.team].name}</span></div>}
    <div className="fantasposi-team-score" aria-label="Punteggio finale squadre">
      {(['bride', 'groom'] as const).map((team) => <article key={team}><span>Team {data.teams[team].name}</span><strong>{data.teams[team].points}</strong></article>)}
      <span className="fantasposi-team-score__versus" aria-hidden="true">VS</span>
    </div>
    {data.players.length >= 3 && <div className="fantasposi-final__podium"><h2>Podio</h2><ol>{data.players.slice(0, 3).map((player) => <li key={player.playerId}><span>{player.rank}</span><strong>{player.displayName}</strong><b>{player.points} pt</b></li>)}</ol></div>}
  </section>;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);
  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  };
  return { canInstall: Boolean(promptEvent), install, isIos, standalone };
}

function FantasyShell({ bootstrap, onLogout }: { bootstrap: BootstrapResponse; onLogout: () => Promise<void> }) {
  const [path, setPath] = useState(window.location.pathname.replace(/\/$/, '') || '/fantasposi');
  const [game, setGame] = useState(bootstrap);
  const [missionsRefreshKey, setMissionsRefreshKey] = useState(0);
  const [predictionsRefreshKey, setPredictionsRefreshKey] = useState(0);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const bootstrapRequestRef = useRef<Promise<void> | null>(null);
  const homeNow = useFantasposiClock(path === '/fantasposi');
  const install = usePwaInstall();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setPath(window.location.pathname.replace(/\/$/, '') || '/fantasposi');
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = (nextPath: string) => {
    window.history.pushState(null, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const refreshBootstrap = useCallback(() => {
    if (bootstrapRequestRef.current) return bootstrapRequestRef.current;
    const request = (async () => {
      try {
        const response = await fantasyFetch('/api/fantasposi/bootstrap');
        if (response.ok) setGame(await response.json() as BootstrapResponse);
      } catch {
        // REST polling/focus recovery is best effort; route-level errors remain local.
      }
    })().finally(() => {
      if (bootstrapRequestRef.current === request) bootstrapRequestRef.current = null;
    });
    bootstrapRequestRef.current = request;
    return request;
  }, []);
  const invalidate = useCallback((scope: FantasposiInvalidation) => {
    if (scope === 'all' || scope === 'phases' || scope === 'missions') {
      setMissionsRefreshKey((value) => value + 1);
    }
    if (scope === 'all' || scope === 'phases' || scope === 'predictions') {
      setPredictionsRefreshKey((value) => value + 1);
    }
    if (scope === 'all') setLeaderboardRefreshKey((value) => value + 1);
    void refreshBootstrap();
  }, [refreshBootstrap]);
  useFantasposiRealtime({ weddingId: game.wedding.id, onInvalidate: invalidate });

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshBootstrap();
      if (path === '/fantasposi/missioni') setMissionsRefreshKey((value) => value + 1);
      if (path === '/fantasposi/pronostici') setPredictionsRefreshKey((value) => value + 1);
      if (path === '/fantasposi/classifica') setLeaderboardRefreshKey((value) => value + 1);
    };
    const interval = window.setInterval(poll, 60_000);
    return () => window.clearInterval(interval);
  }, [path, refreshBootstrap]);
  const teamName = game.wedding.teams[game.player.team];
  const displayName = game.player.displayName || 'Giocatore';
  const homeMissions = game.recommendedMissions
    .filter((mission) => {
      const status = effectiveMissionStatus(mission, homeNow);
      return status === 'available' || status === 'scheduled';
    })
    .sort((left, right) => {
      const leftStatus = effectiveMissionStatus(left, homeNow);
      const rightStatus = effectiveMissionStatus(right, homeNow);
      if (leftStatus !== rightStatus) return leftStatus === 'available' ? -1 : 1;
      if (leftStatus === 'scheduled') {
        return (left.opensAt ?? '').localeCompare(right.opensAt ?? '');
      }
      return left.sortOrder - right.sortOrder;
    })
    .slice(0, 4);

  let content;
  if (path === '/fantasposi/missioni') {
    content = <FantasyMissions gameState={game.gameState} refreshKey={missionsRefreshKey} onSummaryChange={(summary) => setGame((current) => ({
      ...current,
      totalPoints: summary.totalPoints,
      completedMissionCount: current.completedMissionCount + summary.completedDelta,
      availableMissionCount: Math.max(0, current.availableMissionCount + summary.availableDelta),
      recommendedMissions: current.recommendedMissions.filter((mission) => mission.id !== summary.missionId),
    }))} />;
  } else if (path === '/fantasposi/pronostici') {
    content = <FantasyPredictions gameState={game.gameState} refreshKey={predictionsRefreshKey} />;
  } else if (path === '/fantasposi/classifica') {
    content = <FantasyLeaderboard refreshKey={leaderboardRefreshKey} />;
  } else if (path === '/fantasposi/come-si-gioca') {
    content = <FantasyHowToPlay onBack={() => navigate('/fantasposi/profilo')} />;
  } else if (path === '/fantasposi/profilo') {
    content = <section className="fantasposi-profile"><p className="fantasposi-kicker">Il tuo profilo</p><div className="fantasposi-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</div><h1>{displayName}</h1><p>{teamName}</p><button className="fantasposi-primary" type="button" onClick={() => navigate('/fantasposi/come-si-gioca')}>Come si gioca</button>{!install.standalone && <section className="fantasposi-install"><h2>Installa FantaSposi</h2>{install.canInstall ? <button className="fantasposi-secondary" type="button" onClick={() => void install.install()}>Installa sul dispositivo</button> : install.isIos ? <p>In Safari scegli Condividi → Aggiungi alla schermata Home.</p> : <p>Puoi installarlo dal menu del browser quando l’opzione è disponibile.</p>}</section>}<button className="fantasposi-secondary" type="button" onClick={() => void onLogout()}>Esci</button></section>;
  } else {
    content = game.gameState === 'finished'
      ? <FantasyFinalResults refreshKey={leaderboardRefreshKey} />
      : game.gameState === 'setup'
        ? <section className="fantasposi-placeholder"><span aria-hidden="true">✦</span><h1>Il FantaSposi non è ancora iniziato</h1><p>Il tuo profilo è pronto. Torna qui quando gli sposi daranno il via al gioco.</p></section>
        : <section className="fantasposi-home"><p className="fantasposi-kicker">FantaSposi · {game.wedding.brideName} &amp; {game.wedding.groomName}</p><h1>Ciao, {displayName}!</h1><div className="fantasposi-home__meta"><span>{teamName}</span><span>Fase: {game.currentPhase?.name ?? 'In preparazione'}</span></div><div className="fantasposi-score"><span>I tuoi punti</span><strong>{game.totalPoints}</strong></div><div className="fantasposi-home__counts"><div><strong>{game.availableMissionCount}</strong><span>Da completare</span></div><div><strong>{game.completedMissionCount}</strong><span>Completate</span></div></div><section className="fantasposi-now"><div><p className="fantasposi-kicker">Missioni da fare adesso</p><button type="button" onClick={() => navigate('/fantasposi/missioni')}>Vedi tutte</button></div>{homeMissions.length > 0 ? homeMissions.map((mission) => { const status = effectiveMissionStatus(mission, homeNow); return <button type="button" key={mission.id} onClick={() => navigate('/fantasposi/missioni')}><span>{status === 'scheduled' ? `Tra ${fantasposiCountdown(mission.opensAt, homeNow) ?? 'poco'}` : `+${mission.points}`}</span><strong>{mission.title}</strong></button>; }) : <p>Nessuna missione disponibile in questo momento.</p>}</section><section className="fantasposi-home__predictions"><div><p className="fantasposi-kicker">Pronostici aperti</p><strong>{game.openPredictionCount}</strong></div>{game.recommendedPredictions.map((prediction) => <button type="button" key={prediction.id} onClick={() => navigate('/fantasposi/pronostici')}><span>+{prediction.points}</span>{prediction.question}</button>)}<button type="button" onClick={() => navigate('/fantasposi/pronostici')}>Vai ai pronostici</button></section></section>;
  }

  return (
    <main className="fantasposi-app">
      {!online && <p className="fantasposi-offline" role="status">Sei offline. Per giocare e aggiornare i risultati serve una connessione.</p>}
      <header className="fantasposi-topbar"><button type="button" onClick={() => navigate('/fantasposi')}>FantaSposi</button><span>{teamName}</span></header>
      <div className="fantasposi-app__content">{content}</div>
      <nav className="fantasposi-bottom-nav" aria-label="Navigazione FantaSposi">
        {routes.map((route) => <a key={route.path} href={route.path} className={path === route.path ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); navigate(route.path); }}><span aria-hidden="true">{route.icon}</span>{route.label}</a>)}
      </nav>
    </main>
  );
}

export function FantasposiApp() {
  const [state, setState] = useState<FantasyState>({ status: 'loading' });

  const loadAuthenticatedState = useCallback(async () => {
    const meResponse = await fantasyFetch('/api/fantasposi/me');
    if (meResponse.status === 401) {
      setState({ status: 'anonymous' });
      return;
    }
    if (!meResponse.ok) throw new Error(await responseError(meResponse));
    const me = await meResponse.json() as MeResponse;
    if (!me.player || !me.onboardingCompleted) {
      setState({ status: 'onboarding', me });
      return;
    }
    if (!me.player.active) {
      setState({ status: 'inactive', me });
      return;
    }
    const bootstrapResponse = await fantasyFetch('/api/fantasposi/bootstrap');
    if (!bootstrapResponse.ok) throw new Error(await responseError(bootstrapResponse));
    setState({ status: 'ready', bootstrap: await bootstrapResponse.json() as BootstrapResponse });
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Configurazione Supabase Auth non disponibile.');
        return response.json() as Promise<SupabasePublicConfig>;
      })
      .then(async (config) => {
        configureSupabase(config);
        const session = await getSupabaseSession();
        if (!mounted) return;
        if (!session) setState({ status: 'anonymous' });
        else await loadAuthenticatedState();
      })
      .catch((error: unknown) => {
        if (mounted) setState({ status: 'error', message: error instanceof Error ? error.message : 'FantaSposi non disponibile.' });
      });
    return () => { mounted = false; };
  }, [loadAuthenticatedState]);

  const logout = async () => {
    await signOutSupabase();
    setState({ status: 'anonymous' });
  };

  if (state.status === 'loading') return <main className="fantasposi-entry"><p>Prepariamo FantaSposi…</p></main>;
  if (state.status === 'anonymous') return <FantasyLogin onAuthenticated={loadAuthenticatedState} />;
  if (state.status === 'onboarding') return <FantasyOnboarding me={state.me} onCompleted={loadAuthenticatedState} />;
  if (state.status === 'inactive') return <main className="fantasposi-entry"><section className="fantasposi-entry__panel"><h1>Accesso non attivo</h1><p>La tua partecipazione a questo FantaSposi non è attiva.</p><button className="fantasposi-secondary" type="button" onClick={() => void logout()}>Esci</button></section></main>;
  if (state.status === 'error') return <main className="fantasposi-entry"><p className="fantasposi-error" role="alert">{state.message}</p></main>;
  return <FantasyShell bootstrap={state.bootstrap} onLogout={logout} />;
}
