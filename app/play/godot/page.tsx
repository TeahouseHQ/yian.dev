import Script from "next/script";
import React from "react";

export default function Index(): JSX.Element {
  return (
    <>
      <canvas id="canvas">
        HTML5 canvas appears to be unsupported in the current browser.
        <br />
        Please try updating or use a different browser.
      </canvas>
      <Script src="/assets/js/godot.js" strategy="afterInteractive" />
      <Script id="start-godot">
        {`
setTimeout(() => {
const GODOT_CONFIG = {"args":[],"canvasResizePolicy":1,"executable":"helloDot","experimentalVK":false,"fileSizes":{"helloDot.pck":148944,"helloDot.wasm":35708238},"focusCanvas":true,"gdextensionLibs":[]};
const engine = new Engine(GODOT_CONFIG);
const missing = Engine.getMissingFeatures();
if (missing.length > 0) {
  console.error('Missing features:', missing);
}
engine.startGame({
  'onProgress': function (current, total) {
    if (total > 0) {
      console.log('current', current, 'total', total);
    } else {
      console.log('YOLO');
    }
  },
});
},1000);
          `}
      </Script>
    </>
  );
}
