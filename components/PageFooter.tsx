const PageFooter = ({ className }: { className?: string }): React.JSX.Element => {
  return (
    <div className={`w-full md:max-w-4xl mx-auto mb-28 ${className}`}>
      <hr className="w-full border-t-2 border-foreground/20 my-16" />
      <p className="text-center">yian.dev - {new Date().getFullYear()}</p>
    </div>
  );
};

export default PageFooter;
