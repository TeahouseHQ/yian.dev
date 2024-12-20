import { useGame } from "#/lib/GameContext";
import { Tile as TileType, TileValue as TileValueType } from "types/game";
import BaseTile from "./BaseTile";

interface PlayTileProps {
  rowIndex: number;
  colIndex: number;
  tile: TileType;
}

const TileValue = ({
  value,
  isRevealed,
  forceReveal = false,
}: {
  value: TileValueType;
  isRevealed: boolean;
  forceReveal?: boolean;
}) => {
  if (value === 0) {
    return (
      <div className={`${isRevealed ? "animate-explode" : ""}`}>
        {isRevealed || forceReveal ? "💣" : ""}
      </div>
    );
  }

  return <div>{isRevealed || forceReveal ? value : ""}</div>;
};

const PlayTile = ({ rowIndex, colIndex, tile }: PlayTileProps) => {
  const { revealTile, isGameOver } = useGame();

  const handleClick = () => {
    if (!tile.isRevealed) {
      revealTile(rowIndex, colIndex);
    }
  };

  if (isGameOver) {
    return (
      <BaseTile
        className={`
          text-2xl
          transition-colors duration-200
          ${tile.isRevealed ? "bg-white" : "bg-gray-200"}
        `}
        onClick={handleClick}
      >
        <TileValue value={tile.value} isRevealed={tile.isRevealed} forceReveal />
      </BaseTile>
    );
  }

  return (
    <BaseTile
      className={`
        text-2xl
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
    </BaseTile>
  );
};

export default PlayTile;
