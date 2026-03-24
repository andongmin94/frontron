# Frontron Component Starter

This project was generated from the Frontron framework-first starter with a pre-wired component base.

## Stack

- Frontron + React + TypeScript + Vite
- Tailwind CSS 4
- Base UI components under `src/components/ui`
- Root `frontron.config.ts` and `frontron/` app-layer structure
- `frontron/client` bridge access for desktop-only features

## Development

```bash
npm install
npm run dev
npm run app:dev
```

- `npm run dev`: web preview only
- `npm run app:dev`: Frontron desktop runtime + web dev server

## Build

```bash
npm run app:build
```

This runs the web build first and then packages the desktop app through Frontron.

## Notes

- The title bar uses `frontron/client` instead of a custom Electron preload API.
- Generated bridge types are written to `.frontron/types/frontron-client.d.ts`.
- You can build on top of the existing component base in `src/components/ui`.
