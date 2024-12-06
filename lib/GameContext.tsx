import { createContext, useContext, useState, ReactNode } from "react";

import { GameContextType, Tile, TileValue } from "../@types/game";

const GameContext = createContext<GameContextType | undefined>(undefined);

// Create a 5x5 grid with random values (1, 2, 3, or bomb)
const createInitialGrid = (): Tile[][] => {
  const grid: Tile[][] = [];
  for (let i = 0; i < 5; i++) {
    const row: Tile[] = [];
    for (let j = 0; j < 5; j++) {
      const values: TileValue[] = [1, 2, 3, "bomb"];
      const randomValue = values[Math.floor(Math.random() * values.length)];
      row.push({
        value: randomValue,
        isRevealed: false,
      });
    }
    grid.push(row);
  }
  return grid;
};

interface GameProviderProps {
  children: ReactNode;
}

export const GameProvider = ({ children }: GameProviderProps) => {
  const [grid, setGrid] = useState<Tile[][]>(createInitialGrid());

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
    <GameContext.Provider value={{ grid, revealTile }}>
      {children}
    </GameContext.Provider>
  );
};

export const useGame = (): GameContextType => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
};
