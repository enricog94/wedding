# FantaSposi — architettura di base

## Obiettivo

FantaSposi è un modulo PWA mobile-first associato a un singolo matrimonio, ma progettato per condividere la stessa applicazione con matrimoni diversi. Questa iterazione introduce identità del giocatore, onboarding, fasi e lo schema necessario alle future missioni e ai pronostici. Non introduce ancora regole di gioco o punteggi reali.

## Separazione dei domini

- `auth.users` identifica l’account Supabase.
- `profiles` contiene i dati personali riutilizzabili (`display_name`, `avatar_url`).
- `wedding_members` resta riservata all’autorizzazione amministrativa (`wedding_admin`).
- `fantasposi_players` rappresenta la partecipazione al gioco per uno specifico matrimonio.
- Il team è persistito come `bride` o `groom`; l’etichetta pubblica deriva sempre da `weddings.bride_name` e `weddings.groom_name`.

Questa separazione evita che un giocatore diventi implicitamente amministratore e permette allo stesso account di partecipare a matrimoni diversi.

## Schema

- `profiles.avatar_url`: avatar opzionale condiviso dall’account.
- `fantasposi_players`: wedding, account, team, stato onboarding e attivazione.
- `fantasposi_phases`: fasi ordinate e stato `locked`, `active` o `completed`.
- `fantasposi_missions`: catalogo futuro delle missioni, legato a wedding e fase.
- `fantasposi_predictions`: catalogo Pronostici V1, lifecycle, finestra temporale e risposta corretta.
- `fantasposi_prediction_options`: opzioni ordinate a scelta singola, scoped al wedding.
- `fantasposi_player_missions`: stato della missione per giocatore.
- `fantasposi_player_predictions`: risposta scelta e ledger storico dei punti pronostici.

Le foreign key composite `(entity_id, wedding_id)` impediscono di collegare player, fasi, missioni o pronostici appartenenti a matrimoni diversi. Tutti gli ID sono identity PostgreSQL e tutti gli istanti usano `timestamptz`.

## Auth flow

1. Il frontend carica la configurazione pubblica Supabase da `/api/auth/config`.
2. L’utente accede con email OTP/magic link oppure, quando abilitato in Supabase, Google OAuth.
3. La sessione viene persistita e aggiornata usando il refresh token esistente.
4. Il frontend invia il bearer token alle API `/api/fantasposi/*`.
5. Il Worker verifica il token tramite Supabase Auth.
6. Il Worker risolve il wedding esclusivamente tramite `CURRENT_WEDDING_SLUG`.
7. Il Worker cerca `fantasposi_players` usando insieme `wedding_id` e `user_id`.

L’autenticazione non implica né membership FantaSposi né ruolo admin.

## Onboarding flow

1. Benvenuto.
2. Inserimento del nome visualizzato, salvato in `profiles`.
3. Selezione `bride`/`groom`, mostrata con i nomi correnti degli sposi.
4. Conferma e upsert atomico di profilo/player.

Una membership disattivata non può essere riattivata autonomamente tramite onboarding.

## API

- `GET /api/fantasposi/me`: identità, wedding corrente e membership/player.
- `GET /api/fantasposi/bootstrap`: player attivo, fase corrente, fasi e feature flag della shell.
- `GET /api/fantasposi/leaderboard`: punteggi squadra e classifica dei player attivi del wedding corrente.
- `GET /api/fantasposi/predictions`: pronostici disponibili e sola risposta del player corrente.
- `PUT /api/fantasposi/predictions/:id/answer`: inserisce o modifica una risposta finché il pronostico è aperto.
- `POST /api/fantasposi/onboarding`: aggiorna il profilo e crea/completa il player per il wedding corrente.

Il client non invia mai `wedding_id`; tutte le query sono parametrizzate e scoped dal Worker.

## Route frontend

- `/fantasposi`
- `/fantasposi/missioni`
- `/fantasposi/pronostici`
- `/fantasposi/classifica`
- `/fantasposi/profilo`

La navigazione interna usa History API e una bottom navigation mobile. Le route sono servite dal fallback SPA già configurato.

## Fasi iniziali

Le sei fasi non sono hardcoded nella migration globale. Lo script idempotente `scripts/seed-fantasposi-phases.mjs` riceve lo slug del matrimonio e inserisce/aggiorna soltanto:

1. addii
2. serenata
3. cerimonia
4. aperitivo
5. banchetto
6. finale

Lo stato iniziale è `locked`; l’attivazione sarà responsabilità del futuro pannello FantaSposi.

## RLS e privilegi

RLS è abilitata su tutte le nuove tabelle. Il ruolo browser `authenticated`:

- legge soltanto il proprio player;
- legge cataloghi globali solo se possiede un player attivo nello stesso wedding;
- legge relazioni player/mission/prediction soltanto per il proprio player;
- non riceve privilegi di scrittura diretta.

Il Worker `wedding_worker` riceve privilegi espliciti sui cataloghi missioni/pronostici e sola lettura/inserimento/aggiornamento sui rispettivi ledger. I ledger non sono cancellabili direttamente dal Worker. Grants e policy RLS devono essere entrambi presenti: il ruolo non usa `BYPASSRLS`; il browser mantiene sola lettura dei dati consentiti e non scrive direttamente.

## Realtime futuro

Le tabelle hanno chiavi stabili, `wedding_id`, timestamp e relazioni normalizzate compatibili con pubblicazione Realtime futura. Classifiche e punti non sono denormalizzati in questa fase: il modello verrà scelto insieme alle regole effettive per evitare aggiornamenti concorrenti prematuri.

## Mission Engine V1

Una missione è mostrata al giocatore quando appartiene al wedding corrente, è attiva e la relativa fase è `active`. I tipi `action` e `social` si completano manualmente; `photo` richiede una proof valida. I tipi `live` e `automatic` restano riservati a implementazioni future.

### Completion flow

1. Il Worker verifica il JWT Supabase.
2. Risolve il wedding da `CURRENT_WEDDING_SLUG`.
3. Risolve il player attivo usando `user_id` e `wedding_id`.
4. Verifica missione, fase attiva e tipo manuale.
5. Inserisce o aggiorna idempotentemente `fantasposi_player_missions`.
6. Restituisce completion, punti assegnati e totale derivato.

Il vincolo `UNIQUE(player_id, mission_id)` è la garanzia primaria contro due completion contemporanee. L’upsert conserva `points_awarded` se la completion era già conclusa, quindi doppi click o richieste concorrenti non assegnano punti due volte.

### Source of truth punti

Il totale del giocatore non è salvato in `fantasposi_players`. È sempre calcolato come somma del ledger missioni completate e del ledger pronostici risolti. I valori vengono congelati al completamento/risoluzione: modifiche successive ai punti di catalogo non riscrivono lo storico.

Anche il punteggio squadra è derivato sommando le completion dei player attivi raggruppati per `bride` e `groom`.

## Classifica V1

La classifica somma `fantasposi_player_missions.points_awarded` con stato `completed` e `fantasposi_player_predictions.points_awarded` con stato `scored`; non esiste alcun totale denormalizzato. La query parte dai player attivi del wedding e mantiene separati gli aggregati per evitare moltiplicazioni fra ledger. I punteggi squadra sono calcolati dallo stesso insieme di player e le etichette derivano dai nomi correnti in `weddings`.

## Prediction Engine V1

Un pronostico a scelta singola segue `draft → open → closed → resolved`. Può essere globale (`phase_id IS NULL`) oppure associato a una fase; i pronostici di fase sono rispondibili solo durante la fase `active`. `opens_at` e `closes_at` sono guard server-side aggiuntive e non richiedono scheduler.

### Response flow

Il Worker autentica il JWT, risolve wedding e player attivo, quindi valida prediction e option nello stesso scope. L’upsert della risposta usa il vincolo `UNIQUE(player_id, prediction_id)` e blocca la prediction durante la verifica: PUT concorrenti restano consistenti e una chiusura concorrente impedisce modifiche tardive.

### Resolution flow

L’admin chiude esplicitamente il pronostico e lo risolve scegliendo un’opzione appartenente allo stesso prediction/wedding. Una singola statement PostgreSQL blocca il record, imposta `resolved`, congela `points_awarded` per tutte le risposte e valorizza `resolved_at`. Ripetere la stessa risoluzione è una no-op idempotente; cambiare risposta corretta dopo la risoluzione restituisce conflitto.

### Privacy e concorrenza

L’API player non espone risposte altrui, UUID/email o metadati admin. `correctOptionId` è serializzato soltanto dopo `resolved`. Le FK composite impediscono riferimenti cross-wedding; una prediction con risposte non è eliminabile e opzioni/points non sono modificabili dopo il primo utilizzo. Lo storico sopravvive alle modifiche future delle etichette perché la risposta riferisce l’ID opzione stabile.

## Realtime model

La source of truth rimane sempre la REST API del Worker. Supabase Realtime è usato esclusivamente come segnale di invalidazione: un evento sulle tabelle pubblicate viene coalesciato per 200 ms e provoca il refetch degli endpoint REST interessati. Il payload PostgreSQL Changes non viene letto né trasferito nello stato business del client.

Una sola channel autenticata e scoped con `wedding_id` ascolta `INSERT` e `UPDATE` su:

- `fantasposi_phases` → bootstrap, missioni e pronostici;
- `fantasposi_predictions` e `fantasposi_prediction_options` → pronostici e bootstrap;
- `fantasposi_missions` → missioni e bootstrap.

Gli eventi `DELETE` non vengono sottoscritti: PostgreSQL Changes non applica RLS ai delete. Le cancellazioni vengono quindi recuperate dai normali refetch su focus, ritorno in foreground, reconnect/re-subscribe e polling visibile ogni 60 secondi. Le policy RLS già richiedono un player attivo nello stesso wedding; il filtro Realtime è un’ulteriore riduzione, non il confine di sicurezza principale. Un player anonimo o inattivo non riceve righe.

### Effective status

`fantasposi_predictions.status` resta lo stato editoriale (`draft`, `open`, `closed`, `resolved`). Worker e client derivano invece lo stato effettivo:

- `draft` resta non pubblicato;
- `open` prima di `opens_at` diventa `scheduled`;
- `open` dentro la finestra diventa `open`;
- `open` dopo `closes_at` diventa `closed` senza aggiornare il database;
- `closed` resta chiuso manualmente;
- `resolved` mostra risposta corretta e punti congelati.

Il clock locale aggiorna soltanto countdown e passaggi temporali visuali, senza fetch. Le mutation restano validate server-side: una risposta arrivata dopo la chiusura viene rifiutata con `prediction_closed`, provoca un refetch immediato e non mostra successo ottimistico.

### Recovery e degradazione

Focus, `visibilitychange`, ritorno online e ri-sottoscrizione invalidano la cache REST. Home e route dinamiche usano inoltre polling lento ogni 60 secondi, sospeso quando la pagina non è visibile. Se il WebSocket non è disponibile, Auth e funzionalità REST continuano a funzionare normalmente.

### Compatibilità futura Missioni Live

Le missioni attuali hanno `active` e dipendono dallo stato della fase, ma non possiedono `opens_at`, `closes_at` o uno status editoriale dedicato. In questa iterazione non viene simulato un effective status missione. Missioni Live potrà aggiungere in una migration futura i campi temporali/visibilità e derivare `draft`, `scheduled`, `active`, `expired` con lo stesso pattern usato dai pronostici, senza cambiare il modello Realtime-as-invalidation.

Il ranking è una posizione progressiva deterministica `1, 2, 3…`, ordinata per punti decrescenti, numero di missioni completate decrescente, nome visualizzato alfabetico e infine ID player. Non vengono esposti email, UUID Supabase o altri dati personali: l’API restituisce soltanto nome visualizzato, team, punti, numero di completion, posizione e indicazione del player corrente.

La Classifica V1 viene caricata all’apertura della route `/fantasposi/classifica` e quando la route viene riaperta o la pagina aggiornata. Non usa polling né Realtime. Un futuro aggiornamento live potrà sottoscrivere il ledger e invalidare/refetchare la stessa API senza cambiare la source of truth.

### Fase attiva

Un indice univoco parziale garantisce al massimo una fase `active` per wedding. Quando l’admin attiva una nuova fase, la mutation porta atomicamente l’eventuale fase attiva precedente a `completed` e poi attiva quella scelta. Il vincolo database protegge anche da attivazioni concorrenti.

### Admin V1

Il pannello admin esistente contiene l’area FantaSposi con:

- panoramica di giocatori, missioni, completion e punti squadra;
- modifica nome, ordine e stato delle fasi;
- creazione, modifica, attivazione e disattivazione di missioni `action`/`social`/`photo`;
- eliminazione solo di missioni senza completion, per non distruggere lo storico punti.
- CRUD dei pronostici non ancora usati e azioni esplicite di apertura, chiusura e risoluzione.

Le API sono sotto `/api/admin/fantasposi/*`, ereditano la normale autorizzazione admin e risolvono sempre il wedding lato Worker.

### Limiti Mission Engine V1

- nessun workflow di approvazione o verifica semantica delle proof fotografiche;
- nessun Realtime, timer live, prerequisito o mission chain;
- nessuna modifica o revoca delle completion;
- nessuna missione automatica;
- nessuna classifica storica per fase, combo, badge o achievement.

## Non implementato

- catalogo definitivo e approvazione/moderazione delle prove fotografiche;
- classifiche avanzate e Realtime;
- realtime, notifiche e badge;
- missioni segrete o live;
- pannello amministrativo FantaSposi;
- configurazione remota del provider Google.

## Photo Proof model

Le missioni `photo` estendono il Mission Engine e riusano la tabella `media`, la
pipeline preview e lo stesso bucket R2 delle foto del matrimonio. Non esiste un
secondo media system. Ogni originale usa una chiave generata esclusivamente dal
Worker nel namespace privato:

`weddings/{wedding-slug}/fantasposi/proofs/{mission-code}/originals/{uuid}.{ext}`

Il record ha `source = fantasposi_proof`, `wedding_id` e
`uploader_user_id`. La completion conserva soltanto `media_id`; la foreign key
composita con `wedding_id` impedisce associazioni cross-wedding e un indice
univoco impedisce di riusare la stessa prova per missioni diverse.

### Trust e visibilità V1

La presenza di un’immagine caricata e finalizzata è prova sufficiente. V1 non
esegue moderazione, approvazione, AI verification o validazione semantica. Le
proof non sono media pubblici e sono escluse dalle API e dalle operazioni della
gallery, anche quando possiedono preview tecniche. Una futura azione esplicita
di promozione potrà riusare lo stesso oggetto R2 senza duplicarlo.

### Upload e completion

Il player autenticato richiede al Worker una singola signed PUT URL; filename,
player ID, wedding ID e object key non sono mai fidati dal client. Il Worker
accetta solo i MIME immagine e i limiti già condivisi dal media system, verifica
in R2 presenza e dimensione dell’oggetto e finalizza il record prima di
consentire la completion. La completion verifica nuovamente JWT, player attivo,
wedding, ownership, source, prefisso R2, MIME, stato upload, fase e finestra
temporale. Il tempo autorevole è quello della completion: una foto iniziata
prima di `closes_at` non assegna punti se la richiesta arriva dopo la chiusura.

Il vincolo player/mission mantiene l’idempotenza e `points_awarded` congela il
punteggio storico. Un upload riuscito seguito da completion fallita può lasciare
una proof non referenziata: è accettato in V1; una futura manutenzione potrà
rimuovere proof non usate più vecchie di una soglia configurata.

## Roadmap breve

1. Configurazione fasi e cataloghi da admin.
2. Missioni e pronostici con finestre temporali.
3. Ledger dei punti e classifica deterministica.
4. Eventi live/Reatime e strumenti di moderazione.
5. PWA installabile, notifiche e prove media.
