# Blog reader light theme via scoped CSS variables, dark-by-default, post-pages only

The site is unconditionally dark (`body` gets `bg-background text-foreground`; colours are flat hex in `tailwind.config.js`). We're adding a light option to the **Blog reader** (`/posts/[slug]`) only, controlled by a Theme toggle. The decisions that shape it:

## Colours indirect through CSS variables, swapped under `.theme-light`

The semantic Tailwind colours (`background`, `foreground`, `selection`, `line`, `comment`, and the syntax colours) are redefined in `tailwind.config.js` to reference CSS custom properties. The dark values live in `:root`; a `.theme-light` class on `<html>` overrides them. Every existing `bg-background`/`text-foreground` class keeps working unchanged — only the _values_ swap.

Considered and rejected: class-based `dark:`/`light:` Tailwind variants, which would require touching every element on the post page and is error-prone. The tradeoff we accept: colours are no longer greppable as literal hex, and the change is to the global config so it affects colour resolution everywhere (values are identical unless `.theme-light` is present).

## Dark by default; light is opt-in and post-pages only

First-time visitors always get dark, and OS `prefers-color-scheme` is deliberately **ignored** for the default — the rest of the site is unconditionally dark, so a reader arriving from `/home` into an auto-light post would feel jarring. The Theme toggle is the only escape hatch, and it renders only on Blog readers. Non-post pages never carry `.theme-light`.

## No-flash script + client mount handle the two navigation paths

- **Hard load / first paint:** a small blocking inline script in the root `app/layout.tsx`, gated on the pathname starting with `/posts/`, reads the Theme preference from `localStorage` and sets `theme-light` on `<html>` before paint. This avoids a flash of dark on returning light-mode readers, and leaves `/home` etc. always dark with zero flash.
- **Client-side (SPA) navigation:** the inline script does not re-run on `<Link>` transitions, so the Theme toggle client component (present only on Blog readers) applies the preference on **mount** and removes `theme-light` on **unmount**. Entering a post applies the theme; leaving it reverts to dark.

## Deliberate non-goals

- **Code blocks stay dark in both modes.** Syntax highlighting is `atom-one-dark` loaded from a CDN with hardcoded colours that won't follow our variables. Rather than self-host/scope a second light theme, dark code blocks are kept in light mode (common on light blogs).
- **Disqus comments are not live-refreshed on toggle.** Disqus auto-detects light/dark by sampling the page background at load, so the no-flash script makes it correct on arrival. A mid-page toggle leaves the already-loaded iframe in its original theme until the next navigation/reload — calling `DISQUS.reset` to force a match would visibly reload the whole thread, which isn't worth it.
