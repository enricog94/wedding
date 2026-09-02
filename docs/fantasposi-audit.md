# FantaSposi — audit architetturale, sicurezza e consistenza

Data audit: 2026-08-31  
Ambito: Task 1 (fondazione) + Task 2 (Mission Engine V1 e admin)  
Metodo: review statica di migration, Worker, frontend, adapter PostgreSQL e seed. Nessuna migration, seed, query o modifica remota è stata eseguita.

## Esito

**GO condizionato ai fix inclusi in questo working tree.** Prima dell'audit il risultato era **NO-GO**: il ruolo `wedding_worker` non poteva leggere o aggiornare il ledger missioni a causa della combinazione di GRANT e RLS. Il fix incrementale `20260831231000_fantasposi_worker_ledger_policies.sql` ripristina i privilegi strettamente necessari. È stato inoltre ordinato esplicitamente il passaggio tra fase attiva precedente e nuova fase.

## Findings per severità

### CRITICAL — corretto

#### C-1 — Ledger missioni invisibile e non aggiornabile dal Worker

- File: `supabase/migrations/20260831230000_fantasposi_mission_engine_v1.sql`.
- Stato trovato: `wedding_worker` aveva `SELECT, INSERT` sulla tabella, ma soltanto una policy RLS `INSERT`; mancavano policy `SELECT` e policy/grant `UPDATE`.
- Impatto:
  - le query di bootstrap, missioni, somme personali e punteggi squadra non potevano vedere le completion;
  - il primo `UPDATE` del completion flow non era autorizzato;
  - il controllo `NOT EXISTS` usato prima di eliminare una missione non vedeva il ledger, con rischio di cancellazione a cascata dello storico;
  - l'admin avrebbe mostrato conteggi e punteggi errati.
- Fix: migration incrementale `20260831231000_fantasposi_worker_ledger_policies.sql` con `GRANT UPDATE` e policy Worker `SELECT`/`UPDATE`.
- Browser: invariato; `authenticated` conserva soltanto `SELECT` sulle proprie completion.

### HIGH — corretto

#### H-1 — Ordine non deterministico nel cambio fase attiva

- File: `src/api/fantasposi-admin.ts`.
- Stato trovato: `closed_previous` e `updated` erano due data-modifying CTE fratelli senza dipendenza. PostgreSQL non garantisce l'ordine di esecuzione; l'indice univoco parziale della fase attiva è immediato.
- Impatto: l'attivazione di una nuova fase poteva tentare di impostare `active` prima della chiusura della precedente e fallire con conflitto univoco.
- Fix: `updated` consuma esplicitamente il risultato di `closed_previous`, imponendo la dipendenza tra le due operazioni. L'indice univoco continua a garantire al massimo una fase attiva anche con richieste concorrenti.

### MEDIUM — documentati, non modificati

1. Le policy Worker usano `USING (true)`/`WITH CHECK (true)`. Il ruolo non bypassa RLS, ma l'isolamento wedding del Worker resta affidato alle query server-side. Un contesto DB per-request consentirebbe in futuro policy wedding-aware.
2. Un browser `authenticated` con player attivo può interrogare direttamente cataloghi di fasi/missioni/pronostici dello stesso wedding, inclusi record locked/inactive. Non espone altri wedding, ma va ristretto prima di missioni segrete.
3. Qualunque account Supabase autenticato può fare onboarding nel wedding configurato. È coerente con l'onboarding aperto attuale, ma prima del lancio va confermato se serva invito/codice.
4. Un player attivo può ripetere l'onboarding e cambiare team. La uniqueness impedisce duplicati, ma il cambio squadra resta possibile tramite la stessa API.
5. L'adapter apre un nuovo `pg.Client` per ogni query. Bootstrap e completion generano diversi round-trip/connessioni; non è N+1, ma può diventare un limite sotto carico.
6. Mancano indici dedicati su `fantasposi_player_missions(wedding_id, status)` e `fantasposi_player_missions(mission_id)`, utili per overview e protezione delete su dataset grandi.
7. I seed non sono racchiusi in transazione. Un errore intermedio produce un seed parziale; il rerun è idempotente, ma non atomico.
8. Il seed demo aggiorna titolo, descrizione, tipo, punti, fase e ordine dei codici demo esistenti. Un rerun può sovrascrivere modifiche admin su quei record.
9. Il seed demo non fallisce se una fase richiesta manca: conta zero righe e continua. Il numero finale va confrontato con 6.
10. Non esiste ancora una suite SQL locale che esegua assert positivi/negativi su grants e RLS. È raccomandata prima dell'evoluzione multiplayer, pur non bloccando l'applicazione iniziale controllata.

### LOW / NICE TO HAVE — documentati

1. L'admin carica overview, fasi e missioni con un unico `Promise.all`: un errore rende indisponibile l'intero modulo invece della sola sezione.
2. L'API consente transizioni amministrative `completed -> active` e `active -> locked`. Il DB garantisce l'unicità, non una state machine rigida.
3. La risposta immediata al salvataggio fase usa `mission_count = 0`; il frontend esegue subito refetch, quindi il dato si corregge prima della visualizzazione stabile.
4. Su `/fantasposi` l'`App` principale continua a caricare contenuti pubblici e tema prima di renderizzare il modulo: costo superfluo, nessuna regressione funzionale.
5. Per player inattivo con onboarding incompleto il frontend mostra prima l'onboarding, che il backend poi rifiuta; il caso normale inattivo/completo è gestito correttamente.
6. `docs/fantasposi-architecture.md` contiene ancora alcune voci “non implementato” superate dal Task 2. Non è stata modificata perché l'audit non cambia la decisione architetturale.

## Audit migration e schema

Ordine previsto:

1. `20260831220000_fantasposi_base.sql`
2. `20260831230000_fantasposi_mission_engine_v1.sql`
3. `20260831231000_fantasposi_worker_ledger_policies.sql`

Dipendenze dall'iniziale:

- `weddings`, `profiles`, `wedding_members` e ruolo `wedding_worker` devono già esistere;
- `profiles.user_id` deve essere una chiave univoca collegata ad Auth;
- il ruolo è `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`.

Integrità:

- ID applicativi: `bigint GENERATED BY DEFAULT AS IDENTITY`; utenti: `uuid`;
- timestamp: `timestamptz` con `now()`;
- vincoli team, status, tipi missione/pronostico e punti non negativi presenti;
- `UNIQUE(wedding_id, user_id)` impedisce doppio player nello stesso wedding;
- `UNIQUE(player_id, mission_id)` rende idempotente la completion;
- FK composite `(id, wedding_id)` impediscono phase/mission/player/prediction cross-wedding;
- `ON DELETE CASCADE` è appropriato per eliminazione wedding/player. Per missioni con ledger l'API impedisce il delete; il DB da solo consentirebbe il cascade, quindi le mutation server-side restano parte della protezione.
- indice parziale `UNIQUE(wedding_id) WHERE status='active'` garantisce al massimo una fase attiva.

Rischi applicazione:

- `profiles.avatar_url` fallisce se la colonna è stata creata manualmente fuori dalla history migration;
- l'indice della fase attiva fallisce se esistessero già più fasi attive per wedding; nelle migration correnti la tabella nasce vuota e il seed crea fasi locked;
- le migration non hanno down migration e aggiungono tabelle/colonna; il rollback richiede una migration esplicita;
- nessuno statement FantaSposi cancella dati preesistenti durante l'applicazione.

## Audit authentication e authorization

### Player

`Bearer JWT -> Supabase /auth/v1/user -> request hostname -> wedding_domains/weddings -> profiles/fantasposi_players(user_id, wedding_id)`.

- JWT valido non equivale a player: bootstrap, missioni e completion richiedono membership, onboarding completo e player attivo.
- Il client non invia `wedding_id`, `user_id`, `player_id` o punti.
- L'onboarding usa esclusivamente `user.id` verificato e wedding corrente.
- SQL parametrizzato tramite adapter `? -> $n`; nessun valore client è interpolato nel testo SQL.

### Admin

`Bearer JWT -> Supabase /auth/v1/user -> request hostname -> wedding_domains/weddings -> system_role=super_admin OR wedding_members.role=wedding_admin -> handler FantaSposi admin`.

- Le route `/api/admin/fantasposi/*` vengono raggiunte solo dopo `requireAdmin()`.
- Un player non diventa admin.
- Un admin wedding non sceglie il wedding via payload; tutte le mutation usano quello configurato.
- Il super admin conserva accesso globale come identità, ma questo Worker opera comunque sul wedding configurato.

## Audit endpoint player

| Endpoint | Auth/scope | Validazione ed esito |
| --- | --- | --- |
| `GET /api/fantasposi/me` | JWT + wedding corrente + user corrente | Restituisce membership propria o `null`; supporta onboarding. |
| `GET /api/fantasposi/bootstrap` | player proprio, active, onboarding completo | Fasi, riepilogo, suggerimenti e punti; gestisce assenza fase attiva/missioni. |
| `POST /api/fantasposi/onboarding` | JWT e user/wedding server-side | Nome 2–60, team enum; CTE upsert atomico; inactive riceve 403. |
| `GET /api/fantasposi/missions` | player active proprio | Solo missioni active, manuali, della fase active e del wedding. |
| `POST /api/fantasposi/missions/:id/complete` | player active proprio + ID positivo | Missione/wedding/fase/tipo verificati; 404/409 distinti; risposta senza dettagli SQL. |

## Completion, concorrenza e punti

- Prima prova a completare un'eventuale relazione non completata; altrimenti esegue `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING`.
- Due richieste simultanee convergono sul vincolo `(player_id, mission_id)`: una inserisce, l'altra rilegge la completion esistente.
- Un retry dopo timeout restituisce `alreadyCompleted=true` senza nuovo accredito.
- `points_awarded` viene copiato da `mission.points` nella stessa statement che crea/completa il ledger; modifiche successive alla missione non cambiano lo storico.
- Il totale personale e quello squadra sono `SUM(points_awarded) FILTER (WHERE status='completed')`.
- Disattivazione missione o cambio fase concorrenti possono determinare se la completion vede ancora lo stato eleggibile; non possono produrre due ledger o doppio punteggio.
- Una missione già completata resta nel ledger anche se successivamente disattivata o se la fase termina.

## Fasi e mission CRUD

- Al massimo una fase active è garantita dal DB, non soltanto dall'applicazione.
- L'admin modifica sempre `id + wedding_id`; phase di un altro wedding non può essere usata.
- Codice missione normalizzato e validato, uniqueness per wedding, punti interi 0–10000, sort order intero non negativo, V1 limitata ad action/social.
- Create/update con phase dello stesso wedding tramite `INSERT ... SELECT`/`UPDATE ... FROM`.
- Missione con qualunque record `player_missions` non viene cancellata: 409 e indicazione di disattivarla.
- Una race delete/completion resta protetta dalla FK; nel caso peggiore può emergere un errore FK generico anziché 409, senza perdita silenziosa.

## Matrice RLS e grants

Tutte le tabelle seguenti hanno RLS enabled.

| Tabella | authenticated SELECT | authenticated write | wedding_worker grants/policy dopo fix |
| --- | --- | --- | --- |
| `fantasposi_players` | solo proprio `user_id` | nessuno | SELECT/INSERT/UPDATE; policy ALL (DELETE bloccato dal grant) |
| `fantasposi_phases` | stesso wedding se player active | nessuno | SELECT/UPDATE; policy SELECT e UPDATE |
| `fantasposi_missions` | stesso wedding se player active | nessuno | SELECT/INSERT/UPDATE/DELETE; policy ALL |
| `fantasposi_predictions` | stesso wedding se player active | nessuno | nessun grant/policy Worker in V1 |
| `fantasposi_player_missions` | solo record del proprio player | nessuno | SELECT/INSERT/UPDATE; policy separate SELECT/INSERT/UPDATE |
| `fantasposi_player_predictions` | solo record del proprio player | nessuno | nessun grant/policy Worker in V1 |

Privilegi aggiuntivi necessari:

- sequence: player, mission e player_mission;
- `profiles`: SELECT/INSERT/UPDATE per onboarding, con policy Worker esistenti;
- schema `public`: USAGE dalla migration iniziale.

Il Worker non riceve `GRANT ALL`, privilegi Auth, superuser, role creation o `BYPASSRLS`.

## Simulazione multi-wedding

- Player A + Mission B: l'API filtra missione per wedding A e le FK composite impediscono una completion incoerente.
- Admin A + Mission B: update/delete includono `mission.id AND mission.wedding_id=A`.
- Player A + completion Player B: API usa sempre `player.id` risolto dal JWT; RLS browser verifica ownership.
- Join phase A + mission B: FK `(phase_id,wedding_id)` la impedisce.
- Prediction A + player B: entrambe le FK composite sulla relazione la impediscono.
- Il client non può iscriversi a Wedding B passando un ID: nessun endpoint accetta wedding ID/slug.

## Onboarding

- Validazione server-side nome/team presente.
- Upsert concurrent-safe su `profiles.user_id` e `(wedding_id,user_id)`.
- Player active esistente viene aggiornato senza duplicato.
- Player inactive non viene riattivato.
- Repeat onboarding può cambiare team: finding M-4.

## Frontend

- Route dedicate e History API per home, missioni, pronostici, classifica e profilo.
- Login OTP/OAuth torna a `/fantasposi`; sessione persistita e refresh condivisi con il client Supabase esistente.
- Guard statici: anonymous, onboarding, inactive, ready, error.
- Doppio click completion bloccato da `busyId`; backend resta idempotente.
- Dopo completion vengono aggiornati missione, totale, contatori e suggerimenti.
- Refresh ricostruisce lo stato da API; back/forward ascolta `popstate`.
- Nessuna fase active e nessuna missione producono stati vuoti, non crash.
- Pronostici e classifica sono placeholder dichiarati, non dati falsi.

## Performance

- Nessun loop SQL per player e nessun N+1 nelle liste: punti team, summary e missioni sono aggregati in query.
- Bootstrap esegue più query sequenziali; complete esegue più query e riletture. La priorità futura è condividere una connessione/transazione per request senza riscrivere ora l'adapter.
- Admin esegue tre query in parallelo.
- Indici principali presenti su wedding/player/phase; vedere finding M-6 per ledger.

## Residui D1/SQLite

- Il modulo usa l'interfaccia D1-like `prepare/bind/first/all`, ma a runtime è `createPostgresDatabase` con placeholder PostgreSQL e `pg`.
- Nessun uso FantaSposi di `.run()`, `meta.changes`, `last_row_id`, `datetime()`, `strftime()`, `json_extract`, `INSERT OR`, boolean 0/1 o altre funzioni SQLite.
- Le query usano `FILTER`, cast PostgreSQL, `RETURNING`, `ON CONFLICT`, boolean nativi e `CURRENT_TIMESTAMP` compatibile.

## Seed

- Entrambi richiedono esplicitamente `SUPABASE_DATABASE_URL` e `--wedding-slug`.
- Wedding inesistente: errore e nessuna scrittura.
- Fasi: idempotenti su `(wedding_id,code)`, preservano status/date admin.
- Demo: idempotenti sui codici demo e non cancellano record; preservano `active`, ma aggiornano altri campi (M-8).
- Nessun seed è stato eseguito durante l'audit.

## Regressioni resto progetto

- Worker: aggiunti soltanto due handler; Fanta player precede il gate admin ma accetta esclusivamente `/api/fantasposi/*`; Fanta admin viene invocato soltanto dopo autorizzazione.
- Admin: nuova tab isolata, media fetch esclusa quando la tab Fanta è attiva.
- App: route Fanta additiva; Home, gallery, foto e admin conservano i branch esistenti.
- Supabase client: gli alias generici riusano persistenza/refresh/logout admin; nessuna service role nel bundle.
- CSS: selettori Fanta/admin Fanta scoped; nessuna modifica a R2, Queue, Images, Hyperdrive o media pipeline.
- Dipendenze: nessuna nuova dipendenza runtime oltre a quelle già presenti.

## Security review

- SQL injection: non rilevata; input parametrizzati e campi enum/numero/stringa validati.
- IDOR/cross-wedding: non rilevato negli endpoint esistenti; ID combinati con wedding e player risolti server-side.
- Privilege escalation: player e admin separati; onboarding non scrive `wedding_members` o `system_role`.
- Secrets: nessuna service role o connection string nel client; anon key è configurazione pubblica prevista.
- Mass assignment: assente; body mappati campo per campo.
- Punti arbitrari: il client non invia punti assegnati; il valore proviene dalla missione eleggibile.
- Missioni non active/locked/non manuali: completion rifiutata.

## Fonti semantica PostgreSQL/Supabase

- PostgreSQL, Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL, CREATE POLICY: https://www.postgresql.org/docs/current/sql-createpolicy.html
- PostgreSQL, data-modifying WITH: https://www.postgresql.org/docs/current/queries-with.html
- Supabase, RLS grants + policies: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase CLI `db push --dry-run`: https://supabase.com/docs/reference/cli/supabase-db-push

## Procedura controllata per l'applicazione remota

Da PowerShell, dalla root progetto:

```powershell
git status --short
npx supabase link --project-ref <SUPABASE_PROJECT_REF>
npx supabase db push --dry-run
npm run supabase:db:push

$env:SUPABASE_DATABASE_URL='<CONNECTION_STRING_TEMPORANEA>'
npm run fantasposi:seed:phases -- --wedding-slug=serena-enrico-2027
# Opzionale, solo se si vogliono i record demo:
npm run fantasposi:seed:demo -- --wedding-slug=serena-enrico-2027
Remove-Item Env:SUPABASE_DATABASE_URL
```

Controlli SQL read-only dopo migration/seed:

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version IN ('20260831220000', '20260831230000', '20260831231000')
ORDER BY version;

SELECT wedding_id, COUNT(*) FILTER (WHERE status = 'active') AS active_phases
FROM public.fantasposi_phases
GROUP BY wedding_id
HAVING COUNT(*) FILTER (WHERE status = 'active') > 1;

SELECT w.slug, COUNT(p.id) AS phases
FROM public.weddings w
LEFT JOIN public.fantasposi_phases p ON p.wedding_id = w.id
WHERE w.slug = 'serena-enrico-2027'
GROUP BY w.slug;
```

Atteso: tre migration presenti; nessuna riga dalla query delle fasi multiple; sei fasi dopo il seed. Se si esegue il seed demo, il log deve indicare 6 missioni.
