# Supremacy War Room

A responsive strategy-sharing app for Supremacy: World War 3, with a React client, an Express API, and Supabase-hosted PostgreSQL storage.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

Before starting the app, copy `.env.example` to `.env` and set `SUPABASE_SERVICE_ROLE_KEY` to the server-only service-role key from the Supabase project. The Supabase URL is prefilled for this project. Never put the service-role key in frontend configuration or commit `.env`.

```sh
npm install
npm run dev
```

The app is served at `http://localhost:5173`. The development launcher also starts the API on port `3001`; Vite proxies `/api` requests to it. Account data, strategies, comments, messages, and sessions are stored in Supabase. Production web, Android, and Windows builds use the public Supabase Edge API by default; users can still override the API from the app's **Server URL** setting. The public web client is hosted on GitHub Pages and the API uses Supabase's free Edge Functions tier; no paid server is required.

The existing local SQLite files are left untouched and are not imported into Supabase. The app keeps its current bcrypt-password and Express-session authentication; credentials and all database operations stay behind the API. Supabase row-level security is enabled, and only the server's service-role key can access application tables.

If the API is unreachable, the app automatically switches to offline mode. You can create and edit private strategy drafts and high-priority targets, which are saved in that browser or installed app on the current device. Offline drafts are not published; comments, account sign-in, and private messages require a server connection. Use **Retry connection** or configure a server from the top-right menu to reconnect.

The shared strategy feed loads 16 plans at a time; choose **Load more strategies** to fetch another page. Search and category filters are applied by the API so the full published feed remains searchable without downloading it all at startup. After updating a hosted API, rebuild and restart its container with `docker compose up --build -d` to enable paginated responses.

Use the menu in the top-right corner to manage your account, enter the API server URL, and change or reset the saved interface accent color.

The responsive interface supports tablet portrait and landscape layouts, adapts the feed and side panels to the available width, and uses larger touch targets on touchscreens.

The interface combines a subtle animated, perspective tactical grid with the Ghost Family logo projected as a translucent, cyan-violet 3D hologram. Its globe uses a smoothly rotating WebGL orthographic projection of the Natural Earth 1:110m public-domain land map, clipped and shaded as a sphere. The map is uploaded once as a small power-of-two texture; rendering pauses when the app is hidden or reduced motion is requested. Strategy cards defer offscreen rendering, and the feed fetches smaller pages to keep memory use lower.

## Set up a hosted API

The API can also run locally in Docker for development or self-hosting, using the Supabase project configured in `.env`. The public app already uses the Supabase Edge Function API and does not need a separate server:

1. Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Copy `.env.example` to `.env` and set `SUPABASE_SERVICE_ROLE_KEY` to the server-only key from Supabase. Keep the key private.
3. From the project folder, run `npm run api:setup`.
4. Optionally enter the origin of your hosted website when prompted. The setup generates a private session secret and starts the API. If you run setup before setting the Supabase key, it saves the generated secret and asks you to add the key before running setup again.
5. Check `http://localhost:3001/api/health` for `{"status":"ok"}`.

`npm run api:logs` follows API logs; `npm run api:stop` stops the container. To start it again, run `docker compose up -d`.

For self-hosting, put the API behind an HTTPS reverse proxy and configure it to forward requests to port `3001`. The Express API uses secure session cookies in production, so sign-in requires HTTPS. Set `CORS_ORIGINS` in the generated `.env` to the exact origins of any hosted clients, separated by commas. Keep `.env` private; it contains the session signing secret and Supabase service-role key.

To run the production client build:

```sh
npm run build
npm run preview
```

## Installable apps

Both native apps include the client; accounts, strategies, and messages live in Supabase. Public Android and Windows builds connect to the Supabase Edge Function API automatically and use bearer-token sessions, so users do not need to deploy or configure a server. The app's **Server URL** setting remains available for a self-hosted API. The Edge Function allows the GitHub Pages, Capacitor Android, and Electron origins by default.

- Windows installer: `npm run desktop:exe` creates `release/Supremacy War Room Setup.exe`, a bootstrapper under 25 MB that downloads the full installer from the latest GitHub Release and verifies its SHA-256 digest before launching it. An internet connection is required. Each published GitHub Release must include both `Supremacy War Room Setup.exe` and `Supremacy War Room Full Setup.exe`; the latter is the full offline installer. Build staging is kept outside synchronized Documents folders before the files are copied into the project.
- Android APK: install JDK 21 and Android SDK Platform 36 plus build tools. `npm run android:apk` detects the standard Windows Android SDK / Temurin JDK locations, builds, then copies the installable debug APK to `release/Supremacy War Room.apk`.

### Public web app and publish updates for other devices

The GitHub Pages workflow `.github/workflows/pages.yml` publishes the web client at `https://nox122342-blip.github.io/Supremacy-War-Room/`. The Supabase Edge Function serves the API at `https://ckgkfvylkaiyladbxqfp.supabase.co/functions/v1/api`. Both are on free tiers subject to their providers' usage limits.

The GitHub Actions workflow `.github/workflows/release.yml` builds the Windows installer, a signed Android APK, and an optional Docker API image, then publishes installers to a GitHub Release and the image to GitHub Container Registry (`ghcr.io`). Share the repository's **Releases** page (or its `/releases/latest` URL); users can download the newest assets there. Windows users run the new installer over the existing app. Android users install the downloaded APK over the existing app; Android may ask them to allow installs from their browser or file manager.

The public web client and production Windows/Android builds send API requests directly to the Supabase Edge Function using short-lived server-stored bearer sessions. The Supabase service-role key is only used by the Edge Function and never included in app builds. Native users can change the API address from **Server URL** settings if they run a separate backend.

The Android release signing key is configured in GitHub Actions. Keep a secure backup of the same keystore; losing it prevents existing Android users from installing future APK updates. Never commit or share the keystore. The workflow uses these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`: output of `[Convert]::ToBase64String([IO.File]::ReadAllBytes("supremacy-release.keystore"))` in PowerShell.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: key alias.
- `ANDROID_KEY_PASSWORD`: key password.

Create the keystore with `keytool -genkeypair -v -keystore supremacy-release.keystore -alias supremacy -keyalg RSA -keysize 2048 -validity 10000`. Losing this key prevents Android users from installing future APK updates over this release.

To publish a release, increment `version` in `package.json` (and the matching root version in `package-lock.json`), push the commit to `main` to update GitHub Pages, then push a matching version tag such as `v1.0.7`. The workflows reject a tag that does not match the package version. The Android version name and monotonically increasing version code are derived from that version. Signed local builds can be made with `npm run android:release` after setting `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`; the APK is written to `release/Supremacy War Room Release.apk`.

The existing sideloadable APK from `npm run android:apk` is debug-signed, so it cannot be upgraded directly to a release-signed APK. Devices with that debug build must uninstall it before installing the first published release; this removes device-local offline drafts. The published v1.0.6 release is signed, and subsequent releases must keep using the same release keystore so users can install updates without uninstalling.

For a self-hosted deployment, run the Express API with `NODE_ENV=production`, set `SESSION_SECRET` to a cryptographically random value of at least 32 characters, and provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` through the server's private environment. This is optional; it is not needed for the public GitHub Pages and Supabase Edge Function deployment.

## Features

- Public strategy feed with search and category filters.
- Choose a theatre for each strategy; the theatre is saved and used to place it on the map.
- A high-priority tab above the command-feed search box opens a dedicated targets window, with up to 10 targets per account.
- Account registration and sign-in, with bcrypt password hashes in Supabase and server-validated sessions (HTTP-only cookies in Express mode and bearer tokens in Edge Function mode).
- Authenticated strategy publishing and comments.
- Private one-to-one messages between registered accounts.
- Validation and authentication on the API, not only in the client.
