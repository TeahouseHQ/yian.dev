interface BaseTileProps {
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const BaseTile = ({ children, onClick, className = "" }: BaseTileProps) => {
  return (
    <div
      className={`
        w-12 h-12 sm:w-16 sm:h-16
        flex items-center justify-center
        rounded
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

export default BaseTile;
