import { Tile as TileType, TileValue } from "types/game";

import { useGame } from "#/lib/GameContext";

interface TileProps {
  rowIndex: number;
  colIndex: number;
  tile: TileType;
}

const TileValue = ({ value }: { value: TileValue }) => {
  if (value === 0) {
    return <div className="animate-explode">💣</div>;
  }

  return <div>{value}</div>;
};

const Tile = ({ rowIndex, colIndex, tile }: TileProps) => {
  const { revealTile } = useGame();

  const handleClick = () => {
    if (!tile.isRevealed) {
      revealTile(rowIndex, colIndex);
    }
  };

  return (
    <div
      className={`
        w-16 h-16
        flex items-center justify-center
        text-2xl rounded
        transition-colors duration-200
        ${
          tile.isRevealed
            ? "bg-white cursor-default animate-reveal-tile"
            : "bg-gray-200 hover:bg-gray-300 cursor-pointer"
        }
      `}
      onClick={handleClick}
    >
      {tile.isRevealed ? <TileValue value={tile.value} /> : "?"}
    </div>
  );
};

export default Tile;
