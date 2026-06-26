# Bundle analysis

This repo ships `@next/bundle-analyzer` so we can keep an eye on page weight and
catch regressions. The analyzer is **off by default** and only runs when the
`ANALYZE` env var is set, so normal `pnpm build` / CI are unaffected.

## Running it

```bash
pnpm analyze      # ANALYZE=true next build
```

This writes three static reports under `.next/analyze/` (gitignored):

- `client.html` — the client bundle treemap (the one you usually want)
- `nodejs.html` — server / Node runtime bundle
- `edge.html` — edge runtime bundle

Open `client.html` in a browser to inspect per-module sizes.

## Baseline

Captured after issue #48 (FontAwesome CDN removed in favour of tree-shaken
`lucide-react`; confetti moved to a PlayNow-only dynamic import). Next.js build
route table:

| Route (app)                  | Size   | First Load JS |
| ---------------------------- | ------ | ------------- |
| `/`                          | 134 B  | 102 kB        |
| `/_not-found`                | 994 B  | 103 kB        |
| `/about`                     | 240 B  | 106 kB        |
| `/feed.xml`                  | 134 B  | 102 kB        |
| `/home`                      | 240 B  | 106 kB        |
| `/play`                      | 881 B  | 107 kB        |
| `/play/[engineType]/[handle]`| 3.16 kB| 105 kB        |
| `/playnow`                   | 2.65 kB| 105 kB        |
| `/posts/[slug]`              | 6.96 kB| 113 kB        |
| `/projects`                  | 240 B  | 106 kB        |
| `/resume`                    | 479 B  | 103 kB        |
| `/shogun`                    | 1.27 kB| 104 kB        |

**First Load JS shared by all: 102 kB**

| Shared chunk                 | Size   |
| ---------------------------- | ------ |
| `chunks/d1973206-*.js`       | 54.2 kB|
| `chunks/258-*.js`            | 45.8 kB|
| other shared chunks (total)  | 2.17 kB|

### Notable lazy chunks (only loaded on demand)

These are split into separate chunks and never count against first paint on the
routes that don't need them:

| Lazy chunk                   | Size   | Loaded by                            |
| ---------------------------- | ------ | ------------------------------------ |
| `chunks/729.*.js`            | ~86 kB | `@tsparticles/confetti` engine — dynamic-imported only on `/playnow`, and only fired after a win |
| `chunks/816-*.js`            | ~15 kB | `lucide-react` runtime + the two icons actually used (`Play`, `Copy`) |

### Why this matters

Before #48, every page loaded two blocking third-party `<script>` tags from the
root layout: the FontAwesome kit and the `@tsparticles/confetti` bundle. Both
are now gone:

- **Icons** render via tree-shaken `lucide-react` (≈16 kB total, only `Play` and
  `Copy` are pulled in vs ~232 kB for the whole icon set) instead of the FA CDN.
- **Confetti** is `import("@tsparticles/confetti")` inside the `/playnow`
  `GameProvider` (itself loaded via `next/dynamic` with `ssr: false`), so its
  ~86 kB particle engine is fetched only on the PlayNow page, and only after the
  player wins.

Refresh these numbers with `pnpm analyze` whenever you want a current snapshot.
