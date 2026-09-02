# FantaSposi — debito tecnico

Audit aggiornato dopo Photo Proof V1 e il product hardening. Questo documento
registra interventi futuri; non modifica il comportamento corrente.

## NOW

### Copertura automatizzata assente

Vitest copre ora helper temporali, raccomandazioni Home e validazioni pure Photo
Proof. Restano assenti test di integrazione con PostgreSQL/R2/Queue per
idempotenza concorrente dei ledger, scope multi-wedding, risoluzione pronostici e
flusso create/PUT/complete/completion. Non simulare Postgres con mock estesi:
preparare un ambiente locale/CI isolato con casi concorrenti e token non
autorizzati.

### Errori API non uniformi

Le API FantaSposi alternano messaggi italiani e inglesi e non tutte restituiscono
un `code` stabile oltre a `error`. Il client deve ancora interpretare in alcuni
punti solo il testo. Definire gradualmente un catalogo di codici e una response
comune, senza cambiare in blocco gli endpoint esistenti.

### Verifica operativa Photo Proof

Prima del rilascio remoto della feature verificare migration, MIME/limite,
ownership, prefisso R2, upload da dispositivo reale, completion idempotente e
assenza delle proof da gallery e moderazione media. Aggiungere log strutturati
minimi per correlare missione, media e risultato senza dati personali.

## BEFORE WEDDING

### Recovery e pulizia delle proof non usate

DB, R2 e completion non formano una transazione distribuita. Un upload
finalizzato ma non collegato a una completion può restare in R2/`media`. Serve
una procedura schedulata o un runbook che elimini soltanto proof
`fantasposi_proof` non referenziate e più vecchie di una soglia sicura.

### Strumenti operativi per le proof

L'admin non può ancora consultare una proof associata a una completion né
diagnosticare un upload orfano. Prima del matrimonio valutare una vista privata
in sola lettura, senza introdurre moderazione o pubblicazione automatica. Serve
anche un flusso esplicito e separato per l'eventuale promozione di una proof in
gallery: cambiare solo lo status/source corrente sarebbe ambiguo per ownership e
privacy.

### Hard delete di missioni e pronostici

Missioni con completion e pronostici con risposte non sono eliminabili. È una
protezione corretta dello storico, ma l'admin non dispone ancora di un vero
archivio/soft delete. Prima dell'evento valutare uno stato archiviato e mantenerne
esplicita la semantica nei conteggi.

### Realtime e recovery

Realtime è un segnale di invalidazione, non la source of truth. Gli eventi
`DELETE` sono recuperati da focus/reconnect/polling e leaderboard/completion non
hanno una sincronizzazione dedicata. Validare su rete mobile i fallback e
documentare il comportamento atteso quando WebSocket o polling falliscono.

### Date, timezone e stato effettivo

Le regole temporali sono replicate fra CASE SQL, API e frontend
(`effectiveMissionStatus`, `effectivePredictionStatus`, countdown e formatter).
Il database resta autorevole, ma la duplicazione può creare etichette divergenti
al confine degli orari. Prima dell'evento aggiungere test con timezone
`Europe/Rome`, cambio giorno e timestamp invalidi; poi valutare helper condivisi
dove non si duplica la logica SQL.

### Runbook e test su dispositivi reali

Preparare una checklist per OTP/OAuth, onboarding, cambio fase, missioni live,
pronostici, classifica e Photo Proof su iPhone/Android, rete lenta e ripresa dopo
background. Includere limiti R2/Queue/Images e una procedura non distruttiva di
diagnostica.

### Documentazione non completamente allineata

`docs/fantasposi-architecture.md` contiene ancora parti storiche della roadmap
che descrivono come future funzioni già presenti e una nota precedente sui campi
temporali delle missioni. Consolidare il documento prima del freeze operativo.

## LATER

### File e responsabilità troppo grandi

- `src/api/worker.ts`: circa 2.300 righe e routing di più domini.
- `src/api/fantasposi.ts`: circa 1.350 righe.
- `src/frontend/FantasposiApp.tsx`: circa 1.000 righe.
- `src/frontend/styles.css`: circa 4.900 righe.

Quando il prodotto sarà stabile, separare router, query/repository, servizi
media e componenti per route. Evitare questo refactor vicino all'evento.

### Logica e tipi duplicati

Sono duplicati mapping delle entità, formattazione data/ora, status effettivi e
parte del flusso upload diretto (upload pubblico e Photo Proof). Estrarre prima
tipi/primitive pure e solo successivamente componenti o servizi condivisi.

### Evoluzione delle proof

Photo Proof V1 non include moderazione, validazione semantica, revoca o promozione
esplicita in gallery. Qualunque evoluzione deve mantenere separati ownership,
visibilità pubblica e ledger punti; una proof non deve diventare pubblica per il
solo fatto di avere una preview pronta.

La validazione V1 verifica MIME dichiarato, dimensione, ownership, prefisso e
presenza R2, ma non interpreta semanticamente il contenuto. Un'eventuale
validazione AI, moderation o riconoscimento della missione resta esplicitamente
LATER e non deve entrare nel percorso sincrono di assegnazione punti senza una
nuova decisione di prodotto.

### Analytics avanzate

Statistiche per fase, funnel delle missioni, tempi medi e qualità delle proof non
sono necessarie all'MVP. Se introdotte, devono usare dati aggregati e minimizzare
la conservazione di informazioni personali.

### Osservabilità e metriche

Mancano metriche applicative aggregate su error rate delle mutation, ritardi
Realtime e successo degli upload proof. Introdurle solo con il servizio già
disponibile, senza loggare token, email o signed URL.

## Note dell'audit

- Non risultano marcatori `TODO`, `FIXME`, `HACK` o `XXX` nei percorsi verificati.
- Le query e le mutation continuano a dover applicare scope `wedding_id` e
  autorizzazione server-side; il client non è un confine di sicurezza.
- Le ottimizzazioni architetturali sopra sono intenzionalmente rimandate: nessuna
  è necessaria per il product hardening corrente.
