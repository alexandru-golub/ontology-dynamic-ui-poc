"use client";

import { ApolloClient, ApolloProvider as Provider, HttpLink, InMemoryCache } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type DemoUser = { id: string; name: string; role: string };

export const DEMO_USERS: DemoUser[] = [
  { id: "user_101", name: "John Doe", role: "Sales · full row CRUD + surface manage" },
  { id: "user_202", name: "Jane Smith", role: "Analyst · read-only + export" },
  { id: "admin_001", name: "Ada Admin", role: "Super admin · everything" },
];

// Module-level store read by the Apollo link; the React context triggers re-renders.
let activeUserId: string = DEMO_USERS[0].id;
export function getActiveUserId() {
  return activeUserId;
}

const UserContext = createContext<{ user: DemoUser; setUser: (user: DemoUser) => void } | null>(null);

export function useDemoUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useDemoUser must be used within ApolloProvider");
  return ctx;
}

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<DemoUser>(DEMO_USERS[0]);

  const [client] = useState(
    () =>
      new ApolloClient({
        link: setContext((_, { headers }) => ({
          headers: { ...headers, "x-user-id": getActiveUserId() },
        })).concat(new HttpLink({ uri: "/api/graphql" })),
        cache: new InMemoryCache(),
      }),
  );

  const setUser = useCallback((next: DemoUser) => {
    activeUserId = next.id;
    setUserState(next);
  }, []);

  const value = useMemo(() => ({ user, setUser }), [user, setUser]);

  return (
    <UserContext.Provider value={value}>
      <Provider client={client}>{children}</Provider>
    </UserContext.Provider>
  );
}
