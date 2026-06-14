interface Props {
  children?: React.ReactNode;
}

const Container = ({ children }: Props): JSX.Element => {
  return <div className="container mx-auto">{children}</div>;
};

export default Container;
