"use client";

import Script from "next/script";
import React, { useEffect } from "react";

import { createUnityInstance } from "../utils";

type PageProps = {
  handle: string;
};

export default function UnityRenderer({ handle }: PageProps): JSX.Element {
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
      const canvas = document.getElementById("unity-canvas") as HTMLCanvasElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.position = "fixed";
    }

    createUnityInstance(document.querySelector("#unity-canvas"), handle);
  }, [handle]);

  return (
    <>
      <Script src="https://play.yian.dev/WebGL.loader.js" strategy="beforeInteractive" />
      <canvas
        id="unity-canvas"
        width="500"
        height="800"
        tabIndex={-1}
        className="w-[500px] h-[800px] bg-black outline-none"
      />
    </>
  );
}
