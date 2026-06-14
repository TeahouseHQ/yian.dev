import { Metadata } from "next/types";
import React from "react";

import Container from "../../components/Container";
import Logo from "../../components/PpdLogo";
import { Suffix } from "../../lib/constants";

export const metadata: Metadata = {
  title: `Playground${Suffix}`,
};

export default async function Index({ children }): Promise<JSX.Element> {
  return (
    <Container>
      {children}
      <Logo backgroundMode />
    </Container>
  );
}
