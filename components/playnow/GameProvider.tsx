import { useState, ReactNode } from "react";
import { Tile } from "types/game";

import { GameContext, createInitialGrid } from "#/lib/GameContext";

interface GameProviderProps {
  children: ReactNode;
  seed: number;
}

export default function GameProvider({ children, seed }: GameProviderProps) {
  const [grid, setGrid] = useState<Tile[][]>(createInitialGrid(seed));
  const revealTile = (rowIndex: number, colIndex: number) => {
    setGrid((prevGrid) => {
      const newGrid = [...prevGrid];
      newGrid[rowIndex] = [...newGrid[rowIndex]];
      newGrid[rowIndex][colIndex] = {
        ...newGrid[rowIndex][colIndex],
        isRevealed: true,
      };
      return newGrid;
    });
  };

  return (
    <GameContext.Provider value={{ grid, revealTile, seed }}>
      {children}
    </GameContext.Provider>
  );
}
