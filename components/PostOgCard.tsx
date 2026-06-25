import { formatOgDate } from "#/lib/og";

interface Props {
  title: string;
  isoDate: string;
  siteName: string;
  /** Optional author byline rendered next to the date. */
  authorName?: string;
}

/**
 * Presentational Open Graph card rendered to a PNG via `next/og`'s
 * `ImageResponse` (see `app/posts/[slug]/opengraph-image.tsx`).
 *
 * Satori (the renderer behind `ImageResponse`) requires every element with
 * more than one child to be a flex container, so each row here is explicitly
 * `display: "flex"`. The palette mirrors the site's "Tomorrow" terminal theme
 * (`tailwind.config.js`): dark background, the green `>` prompt used by
 * `PostTitle`, comment-gray date, and the yellow selection color for the byline.
 *
 * The component is intentionally side-effect free and inline-styled so it can
 * also be rendered with `react-dom/server`'s `renderToStaticMarkup` in tests,
 * which assert the title/date/branding text content without needing the WASM
 * image pipeline.
 */
export default function PostOgCard({
  title,
  isoDate,
  siteName,
  authorName,
}: Props): React.JSX.Element {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "80px",
        backgroundColor: "#1d1f21",
        backgroundImage: "linear-gradient(135deg, #1d1f21 0%, #282a2e 100%)",
        color: "#c5c8c6",
        fontFamily: "sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 34, fontWeight: 700 }}>
        <span style={{ color: "#b5bd68" }}>&gt;</span>
        <span style={{ marginLeft: 16, color: "#c5c8c6" }}>{siteName}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: "#c5c8c6",
        }}
      >
        {title}
      </div>

      <div style={{ display: "flex", alignItems: "center", fontSize: 34 }}>
        <span style={{ color: "#969896" }}>{formatOgDate(isoDate)}</span>
        {authorName ? <span style={{ marginLeft: 24, color: "#f0c674" }}>{authorName}</span> : null}
      </div>
    </div>
  );
}
