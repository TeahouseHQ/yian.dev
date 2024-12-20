import Grid from "#/components/playnow/Grid";
import { useGame } from "#/lib/GameContext";

export default function Game() {
  const { isGameOver, resetGame, score } = useGame();

  return (
    <div className="relative flex flex-col items-center gap-4 min-h-screen">
      <div className={`text-2xl font-bold my-8 ${isGameOver ? "opacity-30" : ""}`}>
        Score: {score}
      </div>
      <div className={isGameOver ? "opacity-30" : ""}>
        <Grid />
      </div>
      {isGameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
          <div className="text-5xl font-bold mb-8">Game Over</div>
          <button
            className="px-6 py-3 text-xl bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            onClick={resetGame}
          >
            Start Over
          </button>
        </div>
      )}
    </div>
  );
}
