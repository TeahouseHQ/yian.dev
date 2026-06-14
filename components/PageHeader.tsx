import Link from "next/link";

const PageHeader = (): JSX.Element => {
  return (
    <h2 className="text-2xl md:text-4xl font-bold tracking-tight md:tracking-tighter md:text-right leading-tight mb-20 mt-8">
      <Link href="/">PPD</Link>.
    </h2>
  );
};

export default PageHeader;
