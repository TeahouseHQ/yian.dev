"use client";

import Script from "next/script";
import React from "react";

import { getBundleMetadata } from "../../../gameCatalog";

type PageProps = {
  handle: string;
};

export default function GodotRenderer({ handle }: PageProps): JSX.Element {
  const { metadata = {} } = getBundleMetadata(handle) || {};

  return (
    <>
      <canvas
        className="w-[600px] h-[800px] bg-black outline-none"
        id="canvas"
        width={600}
        height={800}
      >
        HTML5 canvas appears to be unsupported in the current browser.
        <br />
        Please try updating or use a different browser.
      </canvas>
      <Script src="/assets/js/godot.js" />
      <Script id="start-godot">
        {`
setTimeout(() => {
const GODOT_CONFIG = JSON.parse('${JSON.stringify(metadata.config)}');
const engine = new Engine(GODOT_CONFIG);
const missing = Engine.getMissingFeatures();
if (missing.length > 0) {
  console.error('Missing features:', missing);
}
engine.startGame({
  'onProgress': function (current, total) {
    if (total > 0) {
      console.log('current', current, 'total', total);
    }
  },
});
},300);
          `}
      </Script>
    </>
  );
}
