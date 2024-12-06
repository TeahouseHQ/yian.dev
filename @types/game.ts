export type TileValue = 1 | 2 | 3 | "bomb";

export interface Tile {
  value: TileValue;
  isRevealed: boolean;
}

export interface GameContextType {
  grid: Tile[][];
  revealTile: (rowIndex: number, colIndex: number) => void;
  seed: number;
}
