import type { Metadata } from "next";
import "./globals.css";
import { ApolloProvider } from "@/components/apollo-provider";
import { SessionProvider } from "@/components/session-provider";

export const metadata: Metadata = {
  title: "Graph Surfaces",
  description: "Neo4j-driven UI surfaces",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ApolloProvider>
          <SessionProvider>{children}</SessionProvider>
        </ApolloProvider>
      </body>
    </html>
  );
}
