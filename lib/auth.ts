/**
 * DB-backed sessions: credentials and session state live in Neo4j.
 *
 *   (User)-[:HAS_SESSION]->(Session {tokenHash, expiresAt, roleName})
 *
 * The browser only ever holds a random opaque token in an httpOnly cookie;
 * the DB stores its SHA-256 hash, so a leaked database cannot replay
 * sessions. `roleName` is the hat (Role) currently worn by the session —
 * permission checks resolve through that role only.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { driver } from "./neo4j";

export const SESSION_COOKIE = "gs_session";
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);
const BCRYPT_COST = 12;

export type SessionUser = {
  id: string;
  name: string;
  isAdmin: boolean;
  /** Hat (Role) currently worn; null = use the user's full set of roles. */
  roleName: string | null;
  roles: string[];
};

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** Pull the session cookie value out of a request. */
export function sessionTokenFromRequest(req: Request): string | null {
  return parseCookies(req.headers.get("cookie"))[SESSION_COOKIE] ?? null;
}

/** Cookie options shared by login/logout. */
export function sessionCookieOptions(expires: Date | null) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

async function loadUserRoles(userId: string): Promise<string[]> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})-[:HAS_ROLE]->(r:Role) RETURN collect(DISTINCT r.name) AS roles`,
      { userId },
    );
    if (!result.records.length) return [];
    const roles = result.records[0].get("roles") as string[];
    return roles.map(String);
  } finally {
    await session.close();
  }
}

export async function getUserInfo(userId: string): Promise<Omit<SessionUser, "roleName" | "roles"> | null> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId}) RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin`,
      { userId },
    );
    if (!result.records.length) return null;
    const record = result.records[0].toObject();
    return { id: String(record.id), name: String(record.name ?? userId), isAdmin: Boolean(record.isAdmin) };
  } finally {
    await session.close();
  }
}

/** Look up a user by login id, including the password hash for verification. */
export async function findUserByLogin(login: string): Promise<{
  id: string;
  name: string;
  isAdmin: boolean;
  passwordHash: string | null;
} | null> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $login})
       RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin, u.passwordHash AS passwordHash`,
      { login },
    );
    if (!result.records.length) return null;
    const record = result.records[0].toObject();
    return {
      id: String(record.id),
      name: String(record.name ?? record.id),
      isAdmin: Boolean(record.isAdmin),
      passwordHash: record.passwordHash ? String(record.passwordHash) : null,
    };
  } finally {
    await session.close();
  }
}

/**
 * Create a session for a user (optionally wearing a specific hat). Expired
 * sessions for the user are lazily deleted in the same transaction.
 */
export async function createSession(
  userId: string,
  roleName: string | null,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const id = `session_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `
MATCH (u:User {id: $userId})
OPTIONAL MATCH (u)-[rel:HAS_SESSION]->(old:Session)
WHERE old.expiresAt IS NULL OR datetime(old.expiresAt) < datetime()
DELETE rel, old
WITH u
CREATE (u)-[:HAS_SESSION]->(s:Session {
  id: $id,
  tokenHash: $tokenHash,
  roleName: $roleName,
  ip: $ip,
  userAgent: $userAgent,
  createdAt: toString(datetime()),
  expiresAt: $expiresAt
})`,
      { userId, id, tokenHash: hashToken(token), roleName, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, expiresAt },
    );
  } finally {
    await session.close();
  }
  return { token, expiresAt };
}

/**
 * Resolve a session token to its user + active hat. Validates expiry and that
 * the session's hat is still one the user actually has (roles change over
 * time; a stale hat degrades to "all hats" instead of erroring).
 */
export async function resolveSession(token: string): Promise<SessionUser | null> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (s:Session {tokenHash: $tokenHash})<-[:HAS_SESSION]-(u:User)
WHERE s.expiresAt IS NULL OR datetime(s.expiresAt) > datetime()
OPTIONAL MATCH (u)-[:HAS_ROLE]->(r:Role)
WITH u, s, collect(DISTINCT r.name) AS roles
RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin, s.roleName AS roleName, roles`,
      { tokenHash: hashToken(token) },
    );
    if (!result.records.length) return null;
    const record = result.records[0].toObject();
    const roles = (record.roles as string[]).filter((r): r is string => r != null).map(String);
    let roleName = record.roleName ? String(record.roleName) : null;
    if (roleName && !roles.includes(roleName)) roleName = null; // stale hat -> all hats
    return {
      id: String(record.id),
      name: String(record.name ?? record.id),
      isAdmin: Boolean(record.isAdmin),
      roleName,
      roles,
    };
  } finally {
    await session.close();
  }
}

/** Resolve the session for a request, or null when unauthenticated. */
export async function getRequestSession(req: Request): Promise<SessionUser | null> {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  return resolveSession(token);
}

/** Delete a session (logout). Returns true when a session was actually removed. */
export async function deleteSession(token: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (s:Session {tokenHash: $tokenHash}) DETACH DELETE s RETURN count(s) AS cnt`,
      { tokenHash: hashToken(token) },
    );
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

/**
 * Switch the active hat of the current session. Verifies the user actually
 * holds the role; null clears the hat (back to the user's full role set).
 */
export async function setSessionHat(token: string, roleName: string | null): Promise<SessionUser | null> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `
MATCH (s:Session {tokenHash: $tokenHash})<-[:HAS_SESSION]-(u:User)
WHERE s.expiresAt IS NULL OR datetime(s.expiresAt) > datetime()
OPTIONAL MATCH (u)-[:HAS_ROLE]->(r:Role)
WITH u, s, collect(DISTINCT r.name) AS roles
WHERE $roleName IS NULL OR $roleName IN roles
SET s.roleName = $roleName
RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin, s.roleName AS roleName, roles`,
      { tokenHash: hashToken(token), roleName },
    );
    if (!result.records.length) return null;
    const record = result.records[0].toObject();
    const roles = (record.roles as string[]).filter((r): r is string => r != null).map(String);
    return {
      id: String(record.id),
      name: String(record.name ?? record.id),
      isAdmin: Boolean(record.isAdmin),
      roleName: record.roleName ? String(record.roleName) : null,
      roles,
    };
  } finally {
    await session.close();
  }
}
