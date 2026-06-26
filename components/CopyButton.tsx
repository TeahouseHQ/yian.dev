"use client";

import { Copy } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface Props {
  /** Raw text content to copy when the button is pressed. */
  text: string;
}

const RESET_MS = 1500;

/**
 * Per-codeblock copy-to-clipboard button. Rendered as a child of each <pre>
 * by the markdown-to-React pipeline, so the existing `pre > button` CSS in
 * styles/index.css applies unchanged.
 */
const CopyButton = ({ text }: Props): React.JSX.Element => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onClick = useCallback(() => {
    void navigator.clipboard.writeText(text.trim()).then(
      () => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), RESET_MS);
      },
      () => {
        // eslint-disable-next-line no-console
        console.error("Failed to copy code to clipboard");
      }
    );
  }, [text]);

  return (
    <button
      type="button"
      aria-label="Copy code to clipboard"
      className={copied ? "copied" : undefined}
      onClick={onClick}
    >
      <Copy size={16} aria-hidden="true" />
      <span>Copied!</span>
    </button>
  );
};

export default CopyButton;
