import BaseTile from "./BaseTile";

interface SummaryTileProps {
  sum: number;
  bombCount: number;
  className?: string;
}

const SummaryTile = ({ sum, bombCount, className = "" }: SummaryTileProps) => {
  return (
    <BaseTile className={`bg-gray-200 ${className}`}>
      <div className="text-sm text-center">
        <div>{sum}</div>
        <div className="text-red">{bombCount}</div>
      </div>
    </BaseTile>
  );
};

export default SummaryTile;
