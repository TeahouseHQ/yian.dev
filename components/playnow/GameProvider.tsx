import { useState, ReactNode } from "react";
import { Tile } from "types/game";

import { GameContext, createInitialGrid, CONSTRAINTS } from "#/lib/GameContext";
import { IS_LOCAL_DEV } from "#/lib/constants";

interface GameProviderProps {
  children: ReactNode;
  initialSeed?: number;
}

function gameWonConfetti() {
  const baseConfetti = {
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    origin: { y: 0.45 },
  };

  window.confetti({
    ...baseConfetti,
    particleCount: 80,
  });
  setTimeout(() => {
    window.confetti({
      ...baseConfetti,
      particleCount: 100,
    });
  }, 200);
}

if (IS_LOCAL_DEV) {
  window.gameWonConfetti = gameWonConfetti;
}

export default function GameProvider({ children, initialSeed }: GameProviderProps) {
  const [seed, setSeed] = useState<number>(initialSeed || Math.floor(Math.random() * Date.now()));
  const [grid, setGrid] = useState<Tile[][]>(createInitialGrid(seed, CONSTRAINTS.easy));
  const [isGameOver, setIsGameOver] = useState(false);
  const [isWinner, setIsWinner] = useState(false);
  const [score, setScore] = useState(1);

  const checkWinCondition = (currentGrid: Tile[][]) => {
    // Check if all tiles with value > 1 are revealed
    for (let row of currentGrid) {
      for (let tile of row) {
        if (tile.value > 1 && !tile.isRevealed) {
          return false;
        }
      }
    }
    return true;
  };

  const revealTile = (rowIndex: number, colIndex: number) => {
    if (isGameOver || isWinner) {
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

      setScore((currentScore) => currentScore * tile.value);

      if (tile.value === 0) {
        setTimeout(() => {
          setIsGameOver(true);
        }, 600);
      } else if (checkWinCondition(newGrid)) {
        setTimeout(() => {
          setIsWinner(true);
          setIsGameOver(true);
          gameWonConfetti();
        }, 100);
      }

      return newGrid;
    });
  };

  const resetGame = () => {
    const newSeed = Math.floor(Math.random() * Date.now());
    setSeed(newSeed);
    setGrid(createInitialGrid(newSeed, CONSTRAINTS.easy));
    setIsGameOver(false);
    setIsWinner(false);
    setScore(1);
  };

  return (
    <GameContext.Provider
      value={{
        grid,
        revealTile,
        seed,
        isGameOver,
        isWinner,
        resetGame,
        score,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
