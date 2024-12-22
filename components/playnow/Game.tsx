import Grid from "#/components/playnow/Grid";
import { useGame } from "#/lib/GameContext";

export default function Game() {
  const { isGameOver, isWinner, resetGame, score } = useGame();

  return (
    <div className="relative flex flex-col items-center gap-4 min-h-screen p-4">
      <div className={`text-2xl font-bold`}>
        {isGameOver && isWinner && `You did it! Score:${score} 🎉`}
        {isGameOver && !isWinner && "Game Over 😓"}
        {!isGameOver && `Score: ${score}`}
      </div>
      <div className={isGameOver ? "opacity-60" : ""}>
        <Grid />
      </div>
      {isGameOver && (
        <>
          <button
            className="px-6 py-3 text-xl bg-blue text-white rounded-lg hover:scale-105 transition-transform"
            onClick={resetGame}
          >
            Start Over
          </button>
        </>
      )}
    </div>
  );
}
