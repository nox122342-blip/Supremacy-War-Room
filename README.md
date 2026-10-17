# Supremacy War Room

Supremacy War Room is a strategy-sharing and command-planning app for **Supremacy: World War 3**. Players publish game plans, browse the community feed, discuss tactics, message each other, and keep a personal list of high-priority targets.

**[Open the web app](https://nox122342-blip.github.io/Supremacy-War-Room/)** · **[Download for Windows and Android](https://github.com/nox122342-blip/Supremacy-War-Room/releases/latest)**

## Features

- **Strategy feed** – browse community game plans with search and category filters (Economy, Warfare, Diplomacy, Logistics). The feed loads in pages with a "Load more" option.
- **Publish strategies** – share a plan with a title, faction, theatre, category, game phase (Early, Mid, Late), summary, up to 8 steps, and tags.
- **Interactive map** – every strategy is placed on a globe/world map by theatre (North America, South America, Europe, Middle East, Africa, Asia-Pacific, or Global).
- **Comments** – discuss any strategy with other commanders.
- **Private messages** – send one-to-one messages to other registered users, with unread counts.
- **High-priority targets** – keep up to 10 personal targets per account.
- **Accounts** – register and sign in with a username and password. Passwords are hashed with bcrypt, and sign-in attempts are rate limited.
- **Offline mode** – if the server is unreachable, you can still write private strategy drafts and targets, which are saved on your device.
- **Personalization** – choose an interface accent color.
- **Responsive design** – works on phones, tablets, and desktops, with touch-friendly controls and an animated tactical-grid look.

## Get the app

| Platform | How to get it |
| --- | --- |
| Web | Open the [web app](https://nox122342-blip.github.io/Supremacy-War-Room/) in any modern browser. |
| Windows | Download `Supremacy War Room Setup.exe` from the [latest release](https://github.com/nox122342-blip/Supremacy-War-Room/releases/latest) and run it. |
| Android | Download `Supremacy War Room Release.apk` from the [latest release](https://github.com/nox122342-blip/Supremacy-War-Room/releases/latest) and install it. Android may ask you to allow installs from your browser or file manager. |

The apps connect to the public server automatically; no setup or server address is needed. Advanced users can enter a custom server URL from the top-right menu.

## How it works

- **Client:** React, TypeScript, and Vite. It is packaged for Windows with Electron and for Android with Capacitor.
- **API:** a Supabase Edge Function, with an Express server available for local development and self-hosting.
- **Database:** Supabase PostgreSQL with row-level security; only the server can access application tables.
- **Hosting:** GitHub Pages for the web app and GitHub Releases for installers.

## Run locally

Requires Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env` and set `SUPABASE_SERVICE_ROLE_KEY` to your server-only Supabase service-role key. Never commit `.env` or share this key.
2. Run:

```sh
npm install
npm run dev
```

The app opens at `http://localhost:5173` and uses a local API on port `3001`.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the production web client. |
| `npm run lint` | Check the code. |
| `npm run desktop:exe` | Build the Windows installer. |
| `npm run android:apk` | Build an Android APK. |

## Releases

Pushing to `main` redeploys the web app. Pushing a version tag such as `v1.0.9` (matching `package.json`) builds the signed Android APK and Windows installers and publishes them to GitHub Releases.
