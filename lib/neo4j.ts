import neo4j from "neo4j-driver";

const uri = process.env.NEO4J_URI ?? "bolt://localhost:7689";
const username = process.env.NEO4J_USERNAME ?? "neo4j";
const password = process.env.NEO4J_PASSWORD ?? "local-dev-password";

const globalForNeo4j = global as unknown as { neo4jDriver?: ReturnType<typeof neo4j.driver> };

export const driver =
  globalForNeo4j.neo4jDriver ?? neo4j.driver(uri, neo4j.auth.basic(username, password));

if (process.env.NODE_ENV !== "production") globalForNeo4j.neo4jDriver = driver;
