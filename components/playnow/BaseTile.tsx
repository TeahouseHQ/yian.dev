interface BaseTileProps {
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const BaseTile = ({ children, onClick, className = "" }: BaseTileProps) => {
  return (
    <div
      className={`
        w-16 h-16
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
