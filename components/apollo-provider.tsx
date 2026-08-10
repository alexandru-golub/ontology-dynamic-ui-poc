"use client";

import { ApolloClient, ApolloProvider as Provider, HttpLink, InMemoryCache } from "@apollo/client";
import { useState } from "react";

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new ApolloClient({
        link: new HttpLink({ uri: "/api/graphql" }),
        cache: new InMemoryCache(),
      }),
  );
  return <Provider client={client}>{children}</Provider>;
}
