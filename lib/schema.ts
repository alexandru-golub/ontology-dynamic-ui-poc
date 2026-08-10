import { Neo4jGraphQL } from "@neo4j/graphql";
import { driver } from "./neo4j";

const typeDefs = /* GraphQL */ `
  type User @node {
    id: ID! @id
    email: String!
    name: String!
    roles: [Role!]! @relationship(type: "HAS_ROLE", direction: OUT)
    organisations: [Organisation!]! @relationship(type: "MEMBER_OF", direction: OUT)
  }

  type Role @node {
    id: ID! @id
    name: String!
    surfaces: [Surface!]! @relationship(type: "CAN_ACCESS", direction: OUT, properties: "SurfaceAccess")
  }

  type SurfaceAccess @relationshipProperties {
    read: Boolean!
    create: Boolean!
    update: Boolean!
    delete: Boolean!
  }

  type Surface @node {
    id: ID! @id
    name: String!
    renderer: String!
    icon: String
    config: String!
    entityType: EntityType @relationship(type: "USES", direction: OUT)
  }

  type EntityType @node {
    id: ID! @id
    name: String!
  }

  type Organisation @node {
    id: ID! @id
    name: String!
  }

  type Customer @node {
    id: ID! @id
    name: String!
    email: String
    status: String!
    organisation: Organisation @relationship(type: "BELONGS_TO", direction: OUT)
    projects: [Project!]! @relationship(type: "HAS_PROJECT", direction: OUT)
    invoices: [Invoice!]! @relationship(type: "HAS_INVOICE", direction: OUT)
  }

  type Project @node {
    id: ID! @id
    name: String!
    customer: Customer @relationship(type: "HAS_PROJECT", direction: IN)
  }

  type Invoice @node {
    id: ID! @id
    number: String!
    total: Float!
    status: String!
    customer: Customer @relationship(type: "HAS_INVOICE", direction: IN)
  }

  type SurfaceConfig {
    columns: [String!]!
    search: [String!]!
    defaultSort: String!
    actions: [String!]!
  }

  type SurfaceView {
    id: ID!
    name: String!
    renderer: String!
    icon: String
    entity: String!
    config: SurfaceConfig!
    permissions: SurfaceAccess!
  }

  type Query {
    mySurfaces: [SurfaceView!]!
    surface(id: ID!): SurfaceView
  }
`;

type SurfaceRecord = {
  id: string;
  name: string;
  renderer: string;
  icon?: string;
  entity: string;
  config: string;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

function toView(record: SurfaceRecord) {
  return {
    id: record.id,
    name: record.name,
    renderer: record.renderer,
    icon: record.icon,
    entity: record.entity,
    config: JSON.parse(record.config),
    permissions: {
      read: record.read,
      create: record.create,
      update: record.update,
      delete: record.delete,
    },
  };
}

async function surfacesForUser(email: string, id?: string) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {email: $email})-[:HAS_ROLE]->(:Role)-[permission:CAN_ACCESS]->(surface:Surface)-[:USES]->(entity:EntityType)
       WHERE $id IS NULL OR surface.id = $id
       RETURN surface.id AS id, surface.name AS name, surface.renderer AS renderer,
              surface.icon AS icon, surface.config AS config, entity.name AS entity,
              permission.read AS read, permission.create AS create, permission.update AS update,
              permission.delete AS delete
       ORDER BY surface.name`,
      { email, id: id ?? null },
    );
    return result.records.map((row) => toView(row.toObject() as SurfaceRecord));
  } finally {
    await session.close();
  }
}

export async function getSchema(userEmail: string) {
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: {
      Query: {
        mySurfaces: () => surfacesForUser(userEmail),
        surface: (_root: unknown, args: { id: string }) => surfacesForUser(userEmail, args.id).then(([surface]) => surface ?? null),
      },
    },
  });
  return neoSchema.getSchema();
}
