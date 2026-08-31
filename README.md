# Serena & Enrico — Wedding website

Sito matrimonio multi-wedding full-stack: React/Vite viene servito dallo stesso
Cloudflare Worker che gestisce API, upload R2, Queue e Cloudflare Images.

## Architettura

- **Frontend:** React + TypeScript + Vite, mobile-first.
- **Backend:** Cloudflare Worker in `src/api/worker.ts`.
- **Database applicativo:** Supabase PostgreSQL.
- **Data layer:** adapter Worker-only in `src/lib/supabase-db.ts`; nessuna chiave
  privilegiata viene inclusa nel browser.
- **Autenticazione admin:** Supabase Auth email OTP, con sessione persistente.
- **Autorizzazione:** `profiles.system_role = 'super_admin'` oppure membership
  `wedding_members.role = 'wedding_admin'` per il matrimonio corrente.
- **Media:** originali e preview restano nel bucket Cloudflare R2 EU
  `wedding-media`; PostgreSQL conserva solo metadata e chiavi oggetto.
- **Selezione wedding:** `CURRENT_WEDDING_SLUG` continua a determinare il
  matrimonio pubblico e il contesto admin.

Le migration D1 storiche sono conservate in `migrations/` come materiale di
rollback/export. Il runtime non usa più il binding D1. Le migration attive sono
in `supabase/migrations/`.

## Requisiti e sviluppo locale

- Node.js 22.13+
- npm
- progetto Supabase
- account Cloudflare con Worker, R2, Images e Queue già configurati
- Supabase CLI per applicare le migration PostgreSQL

Copiando `.dev.vars.example` in `.dev.vars`, configurare:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_DATABASE_URL
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`SUPABASE_DATABASE_URL` usa il ruolo PostgreSQL limitato `wedding_worker` ed è
solo per sviluppo locale. In produzione il Worker usa il binding Hyperdrive.
`/api/auth/config` restituisce al browser soltanto URL e anon key.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Schema e sicurezza Supabase

Applicare `supabase/migrations/20260831000000_initial_schema.sql` con il flusso
Supabase CLI del progetto:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npm run supabase:db:push
```

La migration crea tutte le tabelle applicative D1 equivalenti, usando tipi
PostgreSQL (`date`, `timestamptz`, `boolean`, `uuid`, identity `bigint`), più:

- `profiles`, per il ruolo globale `super_admin`;
- `wedding_members`, per assegnare `wedding_admin` a uno specifico wedding;
- una RPC backend revocata ad `anon` e `authenticated`, usata dall'adapter del
  Worker con service role;
- RLS su tutte le tabelle applicative. I client anon/authenticated non hanno
  policy di scrittura. Ogni utente autenticato può leggere solo il proprio
  profilo e le proprie membership; il Worker media le API pubbliche e admin.

## Supabase Auth e primo amministratore

L'admin usa email OTP, senza password. Nel template email Supabase Auth deve
essere presente `{{ .Token }}` affinché venga inviato il codice numerico.

1. Creare/invitare l'utente in Supabase Auth.
2. Recuperarne l'UUID da `auth.users`.
3. Creare il primo super admin dal SQL Editor:

```sql
INSERT INTO public.profiles (user_id, system_role)
VALUES ('AUTH_USER_UUID', 'super_admin')
ON CONFLICT (user_id) DO UPDATE
SET system_role = EXCLUDED.system_role, updated_at = now();
```

Per limitare un amministratore a un matrimonio:

```sql
INSERT INTO public.profiles (user_id) VALUES ('AUTH_USER_UUID')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.wedding_members (wedding_id, user_id, role)
SELECT id, 'AUTH_USER_UUID', 'wedding_admin'
FROM public.weddings WHERE slug = 'serena-enrico-2027'
ON CONFLICT (wedding_id, user_id) DO UPDATE SET role = EXCLUDED.role;
```

Il Worker verifica il bearer token chiamando Supabase Auth e poi controlla il
ruolo in PostgreSQL. Essere autenticati non conferisce automaticamente accesso
admin.

## Migrazione dati D1 → PostgreSQL

Non eliminare o modificare D1 durante la transizione. Dopo aver applicato lo
schema Supabase, esportare e importare i dati con:

```bash
# PowerShell
$env:SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='SERVER_ONLY_KEY'
npm run data:migrate:supabase
```

Lo script `scripts/migrate-d1-to-supabase.mjs`:

1. legge in sola lettura ogni tabella tramite Wrangler D1 remoto;
2. converte flag 0/1 in boolean e normalizza i timestamp;
3. verifica che le tabelle target siano vuote, poi importa preservando ID e relazioni;
4. riallinea le sequence PostgreSQL;
5. non modifica né cancella D1 e non tocca gli oggetti R2.

Eseguire il passaggio prima su Supabase staging, confrontare i conteggi per
tabella e mantenere D1 disponibile finché API pubbliche, admin, media e Queue
non sono stati verificati.

## Cloudflare e deploy

Impostare le variabili server-side sul Worker esistente:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

Creare una configurazione Hyperdrive verso Supabase usando il ruolo PostgreSQL
`wedding_worker`, quindi aggiungere al Worker il binding `HYPERDRIVE`. La service
role serve soltanto allo script di import e non va configurata sul Worker.
Restano necessari i secret R2 esistenti. `wrangler.jsonc` conserva R2 EU,
Images, Queue, Assets e `CURRENT_WEDDING_SLUG`, ma non contiene più D1.

```bash
npm run deploy
```

Prima del go-live va rimossa o resa bypass l'applicazione Cloudflare Access sui
path `/admin*` e `/api/admin/*`; altrimenti ci sarebbe una doppia autenticazione.
La protezione applicativa rimane Supabase Auth più controllo ruolo server-side.

## Preparazione FantaSposi

Questo task non introduce tabelle o funzioni FantaSposi. Lo schema separa già:

```text
auth.users → profiles / wedding_members → weddings
```

Le future entità player e gameplay potranno riferirsi sia all'account Supabase
sia allo specifico matrimonio senza hardcoding di Serena ed Enrico.
