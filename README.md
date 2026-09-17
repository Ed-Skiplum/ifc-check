# ifc-check

Client-side IFC model health checker and IDS validator. Parsing and validation run
in the browser (WASM in a Web Worker); no backend, no file uploads.

Built as static files and served behind Caddy on its own subdomain; embedded by
skiplum.com in an iframe, so the bundle uses relative asset paths (`base: './'`).

## Stack

Vite · React · TypeScript (strict) · Tailwind v4 (`@tailwindcss/vite`, CSS-first
config in `src/index.css`).

## Develop

```
npm install
npm run dev
```

## Build

```
npm run build      # type-checks, then emits dist/
npm run preview    # serves dist/
```

## Layout

```
src/        application code
public/     static files copied verbatim into dist/
vendor/     vendored wasm-bindgen build (untracked)
```
