import { createContext, useContext } from "react";

import { mulberry32 } from "#/lib/random";
import { GameContextType, Tile, TileValue } from "types/game";
import { IS_LOCAL_DEV } from "./constants";

type GameConstraints = {
  bombCount: { min: number; max: number };
  twoCount: { min: number; max: number };
  threeCount: { min: number; max: number };
};

export const CONSTRAINTS: Record<string, GameConstraints> = {
  easy: {
    bombCount: { min: 4, max: 8 },
    twoCount: { min: 1, max: 4 },
    threeCount: { min: 0, max: 3 },
  },
  medium: {
    bombCount: { min: 6, max: 10 },
    twoCount: { min: 2, max: 6 },
    threeCount: { min: 1, max: 4 },
  },
  hard: {
    bombCount: { min: 6, max: 10 },
    twoCount: { min: 2, max: 8 },
    threeCount: { min: 2, max: 4 },
  },
};

export const GameContext = createContext<GameContextType>({
  grid: [],
  revealTile: () => {},
  resetGame: () => {},
  seed: 0,
  isGameOver: false,
  isWinner: false,
  score: 1,
});

function placeRandomTiles(grid: Tile[][], value: TileValue, count: number, rng: () => number) {
  let placed = 0;
  while (placed < count) {
    const row = Math.floor(rng() * 5);
    const col = Math.floor(rng() * 5);
    if (grid[row][col].value === 1) {
      // If position is empty (default)
      grid[row][col].value = value;
      placed++;
    }
  }
}

function randInt(min: number, max: number, rng: () => number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Create a 5x5 grid with random values (1, 2, 3, or bomb)
export const createInitialGrid = (seed: number, constraints: GameConstraints): Tile[][] => {
  const rng = mulberry32(seed);

  // create an empty grid
  const grid: Tile[][] = Array(5)
    .fill(null)
    .map(() =>
      Array(5)
        .fill(null)
        .map(() => ({ value: 1, isRevealed: false }))
    );

  // place bombs
  placeRandomTiles(
    grid,
    0,
    randInt(constraints.bombCount.min, constraints.bombCount.max, rng),
    rng
  );

  // place twos
  placeRandomTiles(grid, 2, randInt(constraints.twoCount.min, constraints.twoCount.max, rng), rng);

  // place threes
  placeRandomTiles(
    grid,
    3,
    randInt(constraints.threeCount.min, constraints.threeCount.max, rng),
    rng
  );

  if (IS_LOCAL_DEV || !!window.__DEBUG_MODE__) {
    console.log(grid);
  }
  return grid;
};

export const useGame = (): GameContextType => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
};
