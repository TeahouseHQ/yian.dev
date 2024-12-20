import { useGame } from "#/lib/GameContext";
import { TileValue } from "types/game";

import SummaryTile from "./SummaryTile";
import PlayTile from "./PlayTile";
import BaseTile from "./BaseTile";

// Helper function to calculate row statistics
const calculateRowStats = (row: { value: TileValue; isRevealed: boolean }[]) => {
  const sum = row.reduce((acc, tile) => {
    return acc + tile.value;
  }, 0);

  const bombCount = row.filter((tile) => tile.value === 0).length;

  return { sum, bombCount };
};

// Helper function to calculate column statistics
const calculateColStats = (
  grid: { value: TileValue; isRevealed: boolean }[][],
  colIndex: number
) => {
  const column = grid.map((row) => row[colIndex]);
  return calculateRowStats(column);
};

const Grid = () => {
  const { grid } = useGame();

  return (
    <div className="flex flex-col gap-1 p-1 sm:p-4 max-w-full">
      {/* Main grid with row summaries */}
      {grid.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-1 min-w-fit">
          {row.map((tile, colIndex) => (
            <PlayTile
              key={`${rowIndex}-${colIndex}`}
              rowIndex={rowIndex}
              colIndex={colIndex}
              tile={tile}
            />
          ))}
          {/* Row summary */}
          <SummaryTile key={`summary-row-${rowIndex}`} {...calculateRowStats(row)} />
        </div>
      ))}

      {/* Column summaries row */}
      <div className="flex gap-1 min-w-fit">
        {grid[0].map((_, colIndex) => (
          <SummaryTile key={`summary-col-${colIndex}`} {...calculateColStats(grid, colIndex)} />
        ))}
        <BaseTile />
      </div>
    </div>
  );
};

export default Grid;
