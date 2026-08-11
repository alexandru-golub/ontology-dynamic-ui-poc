/**
 * CLI to provision users (real people) and hats (roles) without the UI:
 *
 *   npm run user:create -- --id alice --name "Alice" --password secret --roles "Project Manager,Software Engineer" --admin
 *   npm run user:create -- --id alice --password newsecret        # reset password only
 *   npm run user:create -- --id alice --password "" --no-password # remove login ability
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { driver } from "../lib/neo4j";
import { hashPassword } from "../lib/auth";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("--")) return "";
  return value;
}

async function main() {
  const id = arg("id");
  const name = arg("name");
  const password = arg("password");
  const roles = (arg("roles") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const isAdmin = process.argv.includes("--admin");
  const noPassword = process.argv.includes("--no-password");
  if (!id) {
    console.error("Usage: npm run user:create -- --id <user id> [--name <name>] [--password <pw>] [--roles 'A,B'] [--admin] [--no-password]");
    process.exit(1);
  }

  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    // upsert the user
    const hash = noPassword ? null : password ? hashPassword(password) : undefined;
    const sets: string[] = [];
    if (name !== undefined) sets.push("u.name = $name");
    if (hash !== undefined) sets.push("u.passwordHash = $hash");
    if (isAdmin) sets.push("u.isAdmin = true");
    const setClause = sets.length ? `SET ${sets.join(", ")}` : "";
    const result = await session.run(
      `MERGE (u:User {id: $id})
       ${setClause}
       RETURN u.id AS id, coalesce(u.name, u.id) AS name, coalesce(u.isAdmin, false) AS isAdmin, u.passwordHash IS NOT NULL AS hasPassword`,
      { id, name: name ?? null, hash: hash ?? null },
    );
    if (!result.records.length) {
      console.error(`User ${id} not found/created.`);
      process.exit(1);
    }
    // attach roles
    for (const role of roles) {
      await session.run(
        `MATCH (u:User {id: $id}) MERGE (r:Role {name: $role}) MERGE (u)-[:HAS_ROLE]->(r)`,
        { id, role },
      );
    }
    const user = result.records[0].toObject();
    console.log(
      `User ${user.id} (${user.name}) · admin=${user.isAdmin} · password=${user.hasPassword ? "set" : "none"} · roles=${roles.join(", ") || "(unchanged)"}`,
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
