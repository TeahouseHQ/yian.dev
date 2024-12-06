interface SummaryTileProps {
  sum: number;
  bombCount: number;
  className?: string;
}

const SummaryTile = ({ sum, bombCount, className = "" }: SummaryTileProps) => {
  return (
    <div className={`flex items-center justify-center w-16 h-16 bg-gray-200 rounded ${className}`}>
      <div className="text-sm text-center">
        <div>{sum}</div>
        <div className="text-red-500">{bombCount}</div>
      </div>
    </div>
  );
};

export default SummaryTile;
