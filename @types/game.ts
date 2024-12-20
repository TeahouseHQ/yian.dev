export type TileValue = 1 | 2 | 3 | 0; // 0 is the bomb tile

export interface Tile {
  value: TileValue;
  isRevealed: boolean;
}

export interface GameContextType {
  grid: Tile[][];
  seed: number;
  score: number;
  isGameOver: boolean;
  isWinner: boolean;
  revealTile: (rowIndex: number, colIndex: number) => void;
  resetGame: () => void;
}
