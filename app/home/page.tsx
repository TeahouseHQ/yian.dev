import HomePosts from "#/components/HomePosts";

export default async function HomePage(): Promise<React.JSX.Element> {
  return <HomePosts page={1} />;
}
