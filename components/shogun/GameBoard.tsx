import { useEffect, useState } from "react";
import { GameState, Unit } from "../../lib/shogun/types";
import { GameStateMachine } from "../../lib/shogun/gameState";

interface TileProps {
  unit: Unit | null;
  isPlayer: boolean;
}

const Tile: React.FC<TileProps> = ({ unit, isPlayer }) => {
  if (!unit) {
    return <div className="w-20 h-20 border border-gray-300" />;
  }

  return (
    <div className="w-20 h-20 border border-gray-300 p-2 flex flex-col items-center justify-center">
      <div className={`font-bold ${isPlayer ? "text-blue-600" : "text-red-600"}`}>
        {isPlayer ? "Player" : "Enemy"}
      </div>
      <div className="text-sm">HP: {unit.health}</div>
      <div className="text-xs">{unit.orientation === 1 ? "→" : "←"}</div>
    </div>
  );
};

export const GameBoard: React.FC = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [game] = useState(() => new GameStateMachine());

  useEffect(() => {
    setGameState(game.getState());
  }, [game]);

  if (!gameState) {
    return null;
  }

  const renderTile = (position: number) => {
    // Check if player is in this position
    if (gameState.player.position === position) {
      return <Tile key={position} unit={gameState.player} isPlayer={true} />;
    }

    // Check if any enemy is in this position
    const enemy = gameState.enemies.find((e) => e.position === position);
    if (enemy) {
      return <Tile key={position} unit={enemy} isPlayer={false} />;
    }

    // Empty tile
    return <Tile key={position} unit={null} isPlayer={false} />;
  };

  return (
    <div className="p-4">
      <div className="flex gap-1">
        {Array.from({ length: gameState.worldSize }, (_, i) => renderTile(i))}
      </div>
      <div className="mt-4 space-y-2">
        <div>
          <strong>Player Attack Queue:</strong> {gameState.player.attackQueue.join(", ") || "Empty"}
        </div>
        {gameState.enemies.map((enemy, index) => (
          <div key={index}>
            <strong>Enemy {index} Attack Queue:</strong> {enemy.attackQueue.join(", ") || "Empty"}
          </div>
        ))}
      </div>
    </div>
  );
};
