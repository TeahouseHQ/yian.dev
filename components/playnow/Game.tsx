import Grid from "#/components/playnow/Grid";
import { useGame } from "#/lib/GameContext";

export default function Game() {
  const { isGameOver, isWinner, resetGame, score } = useGame();

  return (
    <div className="relative flex flex-col items-center gap-4 min-h-screen p-4">
      <div className={`text-2xl font-bold`}>
        {isGameOver && isWinner && `You did it! ${score} 🎉`}
        {isGameOver && !isWinner && "Game Over 😓"}
        {!isGameOver && `Score: ${score}`}
      </div>
      <div className={isGameOver ? "opacity-60" : ""}>
        <Grid />
      </div>
      {isGameOver && (
        <>
          <button
            className="px-6 py-3 text-xl bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            onClick={resetGame}
          >
            Start Over
          </button>
        </>
      )}
    </div>
  );
}
