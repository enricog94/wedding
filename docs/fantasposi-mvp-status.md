# FantaSposi — stato MVP

Valutazione del modulo dopo Photo Proof V1 e il primo hardening di prodotto.
Nessuna voce `MISSING` o `OPTIONAL` è stata implementata durante questo audit.

## DONE

- **Lifecycle core:** `setup → active → finished`, controlli admin, blocchi
  server-side delle mutation e risultati finali derivati dai ledger.
- **Reset partita:** wedding-scoped e atomico sui dati player; conserva account,
  team e cataloghi. Le proof orfane richiedono cleanup separato.
- **PWA:** manifest, icone, install UX e cache esclusivamente statica; il gioco
  richiede rete e non accoda azioni offline.

- **Login:** Supabase Auth con OTP email e Google OAuth predisposto; sessione,
  refresh e logout condivisi.
- **Onboarding:** nome visualizzato, scelta Team sposa/sposo e membership scoped
  al matrimonio.
- **Team:** etichette derivate dai nomi correnti del wedding, senza hardcode.
- **Fasi:** catalogo ordinato, una sola fase active e cambio fase atomico.
- **Missioni:** action/social idempotenti con punti congelati nel ledger.
- **Missioni live:** finestre opzionali `opens_at <= now < closes_at`, con stati
  scheduled/available/expired e compatibilità legacy senza orari.
- **Photo Proof V1:** signed PUT R2, namespace dedicato, ownership player,
  finalizzazione upload, media collegato alla completion e nessuna pubblicazione
  automatica in gallery.
- **Pronostici:** opzioni relazionali, finestre temporali, risposta singola,
  chiusura/risoluzione atomica e punti congelati.
- **Classifica:** somma separata dei ledger missioni e pronostici, per player e
  team, senza moltiplicazioni da JOIN.
- **Profilo e Come si gioca:** route protette, team dinamico e guida compatta.
- **Admin:** gestione fasi, missioni, programmazione live, tipo Photo e pronostici.
- **Home:** massimo tre missioni disponibili e una scheduled imminente.

## PARTIAL

- **Realtime:** invalidation layer con una channel per wedding, coalescing,
  cleanup e recovery REST. I DELETE e la leaderboard dipendono ancora dai
  fallback di focus/reconnect/polling.
- **Mobile resilience:** CTA e progress Photo Proof sono robusti contro doppio
  tap e file non validi; mancano test reali sistematici su reti lente,
  background e browser iOS/Android.
- **Media:** pipeline R2/Images condivisa e proof isolate dalla gallery. Non
  esistono cleanup degli orfani, browser admin delle proof o promozione esplicita
  in gallery.
- **Observability:** log tecnici presenti, ma mancano metriche aggregate e una
  correlazione operativa standard per upload/completion.
- **Game-day operations:** l'admin copre le azioni essenziali, ma manca un runbook
  verificato per rete degradata, Queue, rollback di una fase e supporto invitati.
- **Test:** 66 test puri veloci; mancano integrazione PostgreSQL/R2/Queue,
  concorrenza e authorization multi-wedding end-to-end.

## MISSING

- Cleanup sicuro delle proof caricate ma mai collegate a una completion.
- Test di integrazione automatizzati su database e storage isolati.
- Runbook operativo del giorno del matrimonio con controlli e recovery.
- Vista admin privata per diagnosticare proof/completion senza renderle
  pubbliche.
- Metriche minime per errori Auth, completion, upload e ritardo Realtime.

## OPTIONAL

- Soft delete/archivio per missioni e pronostici al posto del solo blocco hard
  delete quando esiste storico.
- Promozione esplicita e consensuale di una Photo Proof nella gallery.
- Moderazione o validazione AI delle proof.
- Badge, combo, classifiche per fase e analytics avanzate.
- Notifiche push e reminder delle missioni live.

## Prossimi task (massimo 5)

1. **P0 — Integration test harness:** PostgreSQL locale/isolato più adapter R2
   controllato per completion concorrenti, scope wedding e Photo Proof.
2. **P0 — Game-day runbook e device test:** iPhone/Android, rete lenta,
   background, OTP, cambio fase, Queue e recovery.
3. **P0 — Orphan proof maintenance:** specifica, dry-run e cleanup con soglia,
   esclusivamente per media non referenziati.
4. **P1 — Admin proof diagnostics:** vista privata in sola lettura per associare
   player, missione, media e stato preview.
5. **P2 — Explicit gallery promotion:** workflow separato, auditabile e opt-in;
   nessuna pubblicazione implicita.
