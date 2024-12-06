import { Tile as TileType } from "#/@types/game";
import { useGame } from "#/lib/GameContext";

interface TileProps {
  rowIndex: number;
  colIndex: number;
  tile: TileType;
}

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
            ? "bg-white cursor-default"
            : "bg-gray-200 hover:bg-gray-300 cursor-pointer"
        }
      `}
      onClick={handleClick}
    >
      {tile.isRevealed ? tile.value : "?"}
    </div>
  );
};

export default Tile;
