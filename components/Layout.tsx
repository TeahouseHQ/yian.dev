import Alert from "./Alert";

interface Props {
  preview?: boolean;
  children: React.ReactNode;
}

const Layout = ({ preview, children }: Props): JSX.Element => {
  return (
    <div className="min-h-screen mx-8">
      <Alert preview={preview} />
      <main>{children}</main>
    </div>
  );
};

export default Layout;
