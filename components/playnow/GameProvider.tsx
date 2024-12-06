import { useState, ReactNode } from "react";
import { Tile } from "types/game";

import { GameContext, createInitialGrid } from "#/lib/GameContext";

interface GameProviderProps {
  children: ReactNode;
  seed: number;
}

export default function GameProvider({ children, seed }: GameProviderProps) {
  const [grid, setGrid] = useState<Tile[][]>(createInitialGrid(seed));
  const [isGameOver, setIsGameOver] = useState(false);

  const revealTile = (rowIndex: number, colIndex: number) => {
    if (isGameOver) {
      return;
    }

    setGrid((prevGrid) => {
      const newGrid = [...prevGrid];
      newGrid[rowIndex] = [...newGrid[rowIndex]];
      const tile = newGrid[rowIndex][colIndex];
      newGrid[rowIndex][colIndex] = {
        ...tile,
        isRevealed: true,
      };

      if (tile.value === 0) {
        setIsGameOver(true);
      }

      return newGrid;
    });
  };

  return (
    <GameContext.Provider value={{ grid, revealTile, seed, isGameOver }}>
      {children}
    </GameContext.Provider>
  );
}
