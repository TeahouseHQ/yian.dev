export type TileValue = 1 | 2 | 3 | 0; // 0 is the bomb tile

export interface Tile {
  value: TileValue;
  isRevealed: boolean;
}

export interface GameContextType {
  grid: Tile[][];
  revealTile: (rowIndex: number, colIndex: number) => void;
  seed: number;
  isGameOver: boolean;
}
