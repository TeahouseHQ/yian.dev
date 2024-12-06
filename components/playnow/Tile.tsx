import { Tile as TileType, TileValue } from "types/game";

import { useGame } from "#/lib/GameContext";

interface TileProps {
  rowIndex: number;
  colIndex: number;
  tile: TileType;
}

const TileValue = ({
  value,
  isRevealed,
  forceReveal = false,
}: {
  value: TileValue;
  isRevealed: boolean;
  forceReveal?: boolean;
}) => {
  if (value === 0) {
    return (
      <div className={`${isRevealed && forceReveal ? "animate-explode" : ""}`}>
        {isRevealed || forceReveal ? "💣" : ""}
      </div>
    );
  }

  return <div>{isRevealed ? value : ""}</div>;
};

const Tile = ({ rowIndex, colIndex, tile }: TileProps) => {
  const { revealTile, isGameOver } = useGame();

  const handleClick = () => {
    if (!tile.isRevealed) {
      revealTile(rowIndex, colIndex);
    }
  };

  if (isGameOver) {
    return (
      <div
        className={`
        w-16 h-16
        flex items-center justify-center
        text-2xl rounded
        transition-colors duration-200
        opacity-60
        ${tile.isRevealed ? "bg-white" : "bg-gray-200"}
      `}
        onClick={handleClick}
      >
        <TileValue
          value={tile.value}
          isRevealed={tile.isRevealed}
          forceReveal
        />
      </div>
    );
  }

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
      <TileValue value={tile.value} isRevealed={tile.isRevealed} />
    </div>
  );
};

export default Tile;
