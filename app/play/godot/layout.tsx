import { Metadata, ResolvingMetadata, Viewport } from "next/types";
import React from "react";

import { Suffix } from "../../../lib/constants";
import { getBundleMetadata } from "../gameCatalog";

type PageProps = {
  params: { handle: string };
};

export const viewport: Viewport = {
  width: "device-width",
  height: "device-height",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export async function generateMetadata(
  { params }: PageProps,
  _: ResolvingMetadata
): Promise<Metadata> {
  const { handle } = params;

  // fetch data
  const gameBundle = getBundleMetadata(handle);

  if (!gameBundle) {
    return {
      title: "Game not found",
      description: "Game not found",
    };
  }

  return {
    title: `${gameBundle.name}${Suffix}`,
    description: gameBundle.description || "",
  };
}

export default async function Index({ children }): Promise<JSX.Element> {
  return (
    <div className="flex justify-center">
      {children}
      <div className="md:fixed md:block hidden bottom-0 right-0 p-2">
        <a href="https://play.yian.dev">play.yian.dev</a>
      </div>
    </div>
  );
}
