# LogHub Frontend — Compuerta de logs

Decoupled web client (HTML + CSS + vanilla JS). It talks **only** to the backend REST API; it has no database access.

## Files

| File                | Role |
|---------------------|------|
| `index.html`        | Page shell (must be lowercase so any host serves it by default) |
| `css/Styles.css`    | Visual identity |
| `js/AppConfig.js`   | Backend URL (the only file you edit to deploy) |
| `js/ApiClient.js`   | REST client (`X-Role` and `X-Client-Id` headers) |
| `js/DashboardApp.js`| UI logic: gate lanes, detail panel, audit feed |

## Run locally

1. Start the backend (`mvn spring-boot:run`, port 8080).
2. Serve this folder on port 5500, e.g. `python3 -m http.server 5500`, and open http://localhost:5500.

## Deploy (GitHub Pages)

1. Edit `js/AppConfig.js` -> `apiBaseUrl: 'https://loghub-backend.onrender.com'`.
2. Push to `https://github.com/YOUR_USER/loghub-frontend` (branch `main`).
3. Repo Settings -> Pages -> Source: **GitHub Actions** (the workflow `DeployPages.yml` publishes it).
4. Public URL: `https://YOUR_USER.github.io/loghub-frontend/`.
5. Put that origin (`https://YOUR_USER.github.io`) in the backend variable `CORS_ORIGINS`.

## What to try

- Role **Invitado** on *Seguridad*: the gate denies it and the stamp appears.
- *Ráfaga de 15* on *Ingesta*: the token bucket blocks the excess.
- Send the same log twice on *Ingesta*: the second is dropped as a repeat.
- Open the same trace twice on *Trazas pesadas*: the second comes from the proxy cache.
