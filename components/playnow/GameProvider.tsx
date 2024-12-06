import { useState, ReactNode } from "react";
import { Tile } from "types/game";

import { GameContext, createInitialGrid } from "#/lib/GameContext";

interface GameProviderProps {
  children: ReactNode;
  initialSeed?: number;
}

export default function GameProvider({
  children,
  initialSeed,
}: GameProviderProps) {
  const [seed, setSeed] = useState<number>(
    initialSeed || Math.floor(Math.random() * Date.now())
  );
  const [grid, setGrid] = useState<Tile[][]>(createInitialGrid(seed));
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(1);

  const revealTile = (rowIndex: number, colIndex: number) => {
    console.log("revealTile", rowIndex, colIndex);
    if (isGameOver) {
      return;
    }

    setGrid((prevGrid) => {
      console.log("prevGrid", prevGrid);
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
      setScore((currentScore) => currentScore * tile.value);

      return newGrid;
    });
  };

  const resetGame = () => {
    const newSeed = Math.floor(Math.random() * Date.now());
    setSeed(newSeed);
    setGrid(createInitialGrid(newSeed));
    setIsGameOver(false);
    setScore(1);
  };

  return (
    <GameContext.Provider
      value={{ grid, revealTile, seed, isGameOver, resetGame, score }}
    >
      {children}
    </GameContext.Provider>
  );
}
