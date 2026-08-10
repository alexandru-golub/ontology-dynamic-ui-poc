# Graph Surfaces

A small Next.js app where Neo4j stores users, access rules, entity metadata, and UI surface definitions. Apollo Client calls a server-side Neo4j GraphQL API; the browser never receives Neo4j credentials.

## Run

```bash
cp .env.example .env.local
npm install
docker compose up -d neo4j
npm run seed
npm run dev
```

Open http://localhost:3000. Or run the complete stack in containers with `docker compose up --build`, then seed from the app container: `docker compose exec app npm run seed`.

Neo4j Browser is available at http://localhost:7477 (neo4j / local-dev-password).

## Architecture

```
React surface renderer → Apollo Client → /api/graphql → Neo4j GraphQL → Neo4j
```

`Surface` is configuration, not a page. Renderer implementations remain code (`TableSurface`, later form/detail/board/graph); definitions and access rules are graph data. The included seed grants John read/create/update customer access but not delete access.

For production, replace the demo email context in `app/api/graphql/route.ts` with verified Clerk, Auth0, or Supabase JWT claims. Enforce data access in the GraphQL layer as the schema grows; hiding UI actions is not authorization.
