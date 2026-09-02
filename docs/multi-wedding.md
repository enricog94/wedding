# Multi-wedding domain resolution V1

## Risoluzione

Ogni richiesta applicativa viene risolta una sola volta dal Worker:

`URL.hostname → wedding_domains → weddings`

Il mapping esplicito ha sempre precedenza. `CURRENT_WEDDING_SLUG` resta un
fallback temporaneo soltanto per `localhost`, `127.0.0.1`, `::1` e host che
terminano in `.workers.dev`. Un hostname custom sconosciuto riceve HTTP 404 con
`code = wedding_not_configured`; non viene mostrato silenziosamente il wedding
reale. Il contesto risolto viene riusato da API pubbliche, admin, media,
contenuti e FantaSposi. Non esiste cache globale: una futura cache dovrà includere
sempre l'hostname nella chiave.

Le route documento della SPA (`/`, `/admin*`, `/foto*`, `/gallery*`,
`/fantasposi*`, `/auth/callback*`) sono configurate con Worker-first. In questo
modo anche la prima apertura della pagina, non soltanto le API, rifiuta un
custom hostname non configurato.

## Wedding test permanente

Dopo aver applicato la migration, impostare localmente `SUPABASE_DATABASE_URL`
con una connessione owner ed eseguire:

```bash
npm run wedding:test:create
```

Lo script è transazionale e idempotente: crea `test-wedding` se assente e
verifica/crea questi mapping senza usare ID fissi:

- `wedding.eshome.it → serena-enrico-2027`
- `test.eshome.it → test-wedding`

Se un hostname o il primary domain appartengono già a un altro wedding, lo
script si ferma invece di rimapparlo. Non crea fasi, missioni o pronostici. Per
un seed minimo opzionale riusare gli script esistenti con
`--wedding-slug=test-wedding`.

## Cloudflare

Configurare `test.eshome.it` come Custom Domain dello stesso Worker
`serena-enrico-wedding` (oppure una route equivalente già adottata
dall'account). Non creare un secondo Worker. Cloudflare gestisce il record DNS
necessario al Custom Domain; se si usa una route, creare prima il record DNS
proxied appropriato. Conservare `wedding.eshome.it` e `workers.dev`.

## Supabase Auth

Aggiungere alle Redirect URLs consentite almeno:

- `https://wedding.eshome.it/auth/callback`
- `https://test.eshome.it/auth/callback`
- `https://test.eshome.it/**` solo se la policy corrente usa wildcard analoghe

Supabase usa il Site URL quando un `redirect_to` non appartiene alla allowlist:
per questo entrambi i callback espliciti sono necessari anche se il client usa
correttamente `window.location.origin`. OTP e OAuth continuano a usare lo stesso
origin di partenza. La sessione è salvata
in `localStorage`, quindi è origin-specific: lo stesso utente effettua login
separatamente sui due sottodomini. Nessuna service role raggiunge il browser.

## Piano manuale di isolamento

1. Applicare migration e script owner; configurare dominio e redirect Supabase.
2. Con lo stesso utente, completare onboarding su entrambi i domini scegliendo
   team differenti.
3. Verificare `/me`, bootstrap, missioni, pronostici e classifica separati.
4. Portare Serena/Enrico in `active` e lasciare Test in `setup`: una completion
   Test deve essere rifiutata senza influire sull'altro wedding.
5. Caricare una photo proof Test e verificare wedding ID e prefisso
   `weddings/test-wedding/fantasposi/proofs/...`.
6. Eseguire reset soltanto sul Test e confrontare ledger e classifica di
   Serena/Enrico prima e dopo.
7. Caricare/approvare media sui due domini e verificare gallery e download
   completamente separati.

## Hardcode residui

`DEFAULT_WEDDING`, il mapping tema `serena-enrico-2027`, copy dell'admin, la
foto hero editoriale di fallback e alcuni contenuti/seed demo Serena-Enrico
restano statici. Sono fallback visuali o contenuti editoriali legacy e non
determinano più lo scope DB, FantaSposi, media o autorizzazione. Il bootstrap
del tema usa il tema di default senza leggere uno slug; dopo la risposta API il
tema viene selezionato usando lo slug risolto dal backend. Il manifest PWA resta
volutamente generico e ogni service worker è già isolato dall'origine del
browser.
