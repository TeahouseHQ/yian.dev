import Link from "next/link";
import React from "react";

import { GameBundles, getGamePath } from "../../lib/gameCatalog";

const CardClassNames = {
  base: "relative rounded-lg md:h-[400px] md:w-[400px] w-full h-fit min-h-[300px] m-4 bg-cover bg-center bg-no-repeat transition origin-center overflow-hidden shadow-sm",
  hover: "hover:scale-105 hover:shadow-md",
  hide: "translate-x-full rotate-90 opacity-0",
};

export default function Index(): JSX.Element {
  return (
    <>
      <h1 className="text-center m-4">Play</h1>
      <div className="flex flex-wrap justify-center w-full p-4 max-w-4xl mx-auto">
        {Object.keys(GameBundles).map((handle, i) => (
          <div
            className={`${CardClassNames.base} ${CardClassNames.hover}`}
            key={handle}
            style={{
              backgroundImage: `url(${GameBundles[handle].screenshots[0]})`,
            }}
          >
            <div className="absolute flex items-center w-full bottom-0 left-0 min-h-[100px] bg-black bg-opacity-50 backdrop-blur-sm p-3 text-neutral-100">
              <div className="flex flex-col flex-grow">
                <h2>
                  {GameBundles[handle].name}
                  <span className="text-xs mx-1 text-neutral-400">{`[v${GameBundles[handle].version}]`}</span>
                </h2>
                <div className="text-neutral-300">
                  {GameBundles[handle].description ||
                    "No Description. Just hit play."}
                </div>
              </div>
              <div className="flex-grow-0 text-4xl">
                <Link href={getGamePath(handle)} target="_blank">
                  <i className="fas fa-play transition-colors hover:text-green-200 "></i>
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
