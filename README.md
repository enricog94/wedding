# Serena & Enrico — Wedding website

Sito full-stack del matrimonio di Serena ed Enrico, aggiornato alla milestone M1. Il progetto usa un unico Cloudflare Worker: React/Vite genera il frontend statico, mentre lo stesso deployment gestisce le route `/api/*`, D1 e R2.

M1 include Home, countdown, programma, location, informazioni utili e navigazione responsive. Il design system mobile-first usa Style Script, Cormorant Garamond e Inter, con palette avorio, salvia, oliva e champagne.

## Architettura

- **Frontend:** React + TypeScript, mobile-first, compilato da Vite.
- **Backend:** Cloudflare Worker TypeScript in `src/api/worker.ts`.
- **Database:** Cloudflare D1, binding `DB`.
- **Object storage:** Cloudflare R2, binding `MEDIA_BUCKET` (predisposto, non ancora usato).
- **Routing:** gli URL `/api/*` passano al Worker; gli altri URL vengono serviti dagli asset Vite con fallback SPA.

Endpoint disponibili:

- `GET /api/health` → `{ "status": "ok" }`
- `GET /api/config` → legge `wedding_date` da D1
- `GET /api/wedding/current` → restituisce il matrimonio attivo
- `GET /api/weddings/:slug` → restituisce il matrimonio associato allo slug

Il matrimonio mostrato dalla Home e restituito da `/api/wedding/current` è selezionato esplicitamente dalla variabile Worker non sensibile `CURRENT_WEDDING_SLUG`, configurata in `wrangler.jsonc`.

## Requisiti

- Node.js 22.13 o successivo
- npm
- un account Cloudflare solo per creare le risorse remote e distribuire

Non servono credenziali Cloudflare per lo sviluppo locale.

## Installazione

```bash
npm install
npm run db:migrate:local
npm run dev
```

Aprire l'indirizzo mostrato da Vite (normalmente `http://localhost:5173`). Il plugin Cloudflare esegue frontend e Worker insieme: non occorrono due processi separati.

La data è inclusa anche nel bundle come fallback, così la Home resta visibile se D1 locale non è ancora migrato; `/api/config` richiede invece la migration.

## Sviluppo locale

Il flusso consigliato è:

```bash
npm run db:migrate:local
npm run dev
```

In alternativa, dopo una build si può eseguire il Worker direttamente con:

```bash
npm run build
npx wrangler dev
```

Controlli rapidi mentre il server è attivo:

```bash
curl http://localhost:5173/api/health
curl http://localhost:5173/api/config
```

Wrangler salva database e bucket locali sotto `.wrangler/`, esclusa da Git.

## Build e controlli

```bash
npm run typecheck
npm run lint
npm run build
npm run preview
```

`npm run preview` è utile per il solo output frontend. Per verificare anche le API della build usare `npx wrangler dev`.

## Configurazione D1

Il progetto è collegato al database D1 remoto esistente `wedding-db`. Per applicare le migration:

```bash
npm run db:migrate:remote
```

La migration `migrations/0001_initial.sql` crea `app_config` e inserisce `wedding_date = 2027-07-24`; resta disponibile per compatibilità M0/M1. La migration `migrations/0002_weddings.sql` introduce il modello wedding predisposto al futuro supporto multi-matrimonio e inserisce Serena ed Enrico come matrimonio attivo.

## Configurazione R2

Il progetto è collegato esplicitamente al bucket R2 esistente `wedding-media` con jurisdiction `eu`. Il binding `MEDIA_BUCKET` è disponibile al Worker. Il deploy disabilita inoltre il provisioning automatico di Wrangler. M1 non espone upload, lettura pubblica o credenziali R2. Nessuna chiave o secret deve essere aggiunta al repository.

## Deployment

Dopo aver verificato l'autenticazione Wrangler e applicato la migration remota:

```bash
npm run deploy
```

Wrangler crea o aggiorna il Worker `serena-enrico-wedding` e pubblica gli asset del frontend nello stesso deployment.

## Struttura delle cartelle

```text
src/
  frontend/       # entry React, Home e stile globale
  api/            # Worker e route API
  components/     # componenti React riutilizzabili
  lib/            # client API e utilità condivise
migrations/       # migration D1 versionate
public/           # asset statici futuri
photobooth/       # placeholder per la futura integrazione Linux
```

I file principali alla radice sono `wrangler.jsonc`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js` e `index.html`.

## Fuori scope per M1

Non sono ancora implementati login, RSVP, upload o URL firmati, gallery, area admin, sync Photobooth, Turnstile e Fantasposi. Non esistono ancora tabelle guest, media o RSVP. Il bucket R2 è soltanto configurato come binding.

## Convenzioni multi-wedding future

Le future tabelle legate a invitati, RSVP e media dovranno contenere `wedding_id` come foreign key verso `weddings.id`. Gli oggetti nel bucket R2 dovranno essere separati per matrimonio usando il namespace `weddings/{wedding-slug}/...`.

## Dati da completare nelle prossime milestone

- aggiungere indirizzi e link reali per Chiesetta di Cendrole e Villa Peggy's;
- definire parcheggio, contatti, dress code ed eventuali servizi di navetta/pernottamento;
- definire i requisiti dati e privacy per invitati e media prima di estendere lo schema.
