"use client";

import { ApolloClient, ApolloProvider as Provider, HttpLink, InMemoryCache } from "@apollo/client";
import { useState } from "react";

/**
 * Plain Apollo client. Identity no longer rides an `x-user-id` header —
 * the GraphQL route resolves the acting user from the DB-backed session
 * cookie (lib/auth.ts), so the client only needs the same-origin POST.
 */
export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new ApolloClient({
        link: new HttpLink({ uri: "/api/graphql", credentials: "same-origin" }),
        cache: new InMemoryCache(),
      }),
  );
  return <Provider client={client}>{children}</Provider>;
}
