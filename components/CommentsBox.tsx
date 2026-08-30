"use client";
import { useEffect, useRef } from "react";

import { LIGHT_THEME_CLASS, themeForClass, type ReaderTheme } from "#/lib/theme";
import {
  GISCUS_ORIGIN,
  buildGiscusScriptAttributes,
  giscusSetConfigMessage,
  resolveGiscusConfig,
} from "#/lib/giscus";

type Props = {
  /**
   * The discussion term this post's comments map to. Always the post's
   * stable front-matter `id` (a UUID), never the slug, so renaming a post
   * or editing its title never orphans the thread.
   */
  term: string;
  enabled?: boolean;
};

/**
 * Ask the Giscus iframe to switch theme live (ADR-0005). Unlike Disqus,
 * Giscus listens for `setConfig` messages (wrapped in the `giscus` envelope
 * its client requires) from the embedding page, so the comment widget
 * follows the Theme toggle without reloading the thread.
 */
function pushTheme(iframe: HTMLIFrameElement | null, theme: ReaderTheme): void {
  iframe?.contentWindow?.postMessage(giscusSetConfigMessage(theme), GISCUS_ORIGIN);
}

/**
 * Post comments, backed by GitHub Discussions via Giscus (issue #43).
 * Rendered on Blog readers below the article when the post's front matter
 * sets `commentsEnabled`.
 *
 * Giscus is configured through `NEXT_PUBLIC_GISCUS_*` variables (see
 * {@link resolveGiscusConfig}); while the opaque repo/category ids are
 * unset — Discussions not yet enabled — nothing renders at all, server or
 * client, instead of a broken embed.
 *
 * The server render stops at the empty host container; the client effect
 * injects the `giscus.app/client.js` script with the attribute map from
 * {@link buildGiscusScriptAttributes}. The initial `data-theme` comes from
 * the reader theme already applied to `<html>` (no-flash script /
 * {@link ThemeToggle}); a MutationObserver on the `<html>` class then
 * forwards every toggle to the iframe so light/dark switching applies to
 * comments live.
 */
const CommentsBox = (props: Props): React.JSX.Element | null => {
  const { term, enabled } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Resolved at render: NEXT_PUBLIC_ vars are inlined at build time, so the
  // server render (SSG) and the client bundle always agree.
  const config = enabled
    ? resolveGiscusConfig({
        repo: process.env.NEXT_PUBLIC_GISCUS_REPO,
        repoId: process.env.NEXT_PUBLIC_GISCUS_REPO_ID,
        category: process.env.NEXT_PUBLIC_GISCUS_CATEGORY,
        categoryId: process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID,
      })
    : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!config || !host) {
      return;
    }

    const currentTheme = themeForClass(
      document.documentElement.classList.contains(LIGHT_THEME_CLASS)
    );

    const script = document.createElement("script");
    for (const [name, value] of Object.entries(
      buildGiscusScriptAttributes(config, term, currentTheme)
    )) {
      script.setAttribute(name, value);
    }
    script.async = true;
    host.appendChild(script);

    // Forward reader-theme toggles to the widget for the lifetime of the
    // page; the iframe may not exist yet on early toggles (lazy load), in
    // which case the update is a no-op. Unrelated class changes are ignored
    // by only posting when the theme actually flipped.
    let lastTheme = currentTheme;
    const observer = new MutationObserver(() => {
      const next = themeForClass(document.documentElement.classList.contains(LIGHT_THEME_CLASS));
      if (next !== lastTheme) {
        lastTheme = next;
        pushTheme(host.querySelector("iframe"), next);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
      // Drop the injected script/iframe so re-running the effect (React 18
      // strict mode) never duplicates the widget.
      host.replaceChildren();
    };
  }, [config, term]);

  if (!config) {
    return null;
  }

  return (
    <div className="mx-auto mb-32 max-w-4xl">
      <div ref={hostRef} data-giscus-host="" />
    </div>
  );
};

export default CommentsBox;
