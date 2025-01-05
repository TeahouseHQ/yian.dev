import { GameBoard } from "./GameBoard";

export const GameContainer: React.FC = () => {
  return (
    <div className="container mx-auto">
      <h1 className="text-2xl font-bold mb-4">Shogun Game</h1>
      <GameBoard />
    </div>
  );
};
