"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type SessionUser = { id: string; name: string; isAdmin: boolean };
export type SessionState = {
  user: SessionUser | null;
  roleName: string | null;
  roles: string[];
  loading: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  switchHat: (roleName: string | null) => Promise<string | null>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

type SessionPayload = {
  user: SessionUser | null;
  roleName: string | null;
  roles: string[];
};

async function post(path: string, body: unknown): Promise<{ ok: boolean; payload: SessionPayload; error?: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
  return {
    ok: response.ok,
    payload: { user: data.user ?? null, roleName: data.roleName ?? null, roles: data.roles ?? [] },
    error: data.error,
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await response.json()) as SessionPayload;
      setUser(data.user);
      setRoleName(data.roleName);
      setRoles(data.roles ?? []);
      if (!data.user) {
        router.replace("/login");
        router.refresh();
      }
    } catch {
      setUser(null);
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string): Promise<string | null> => {
      const { ok, payload, error } = await post("/api/auth/login", { username, password });
      if (!ok) return error ?? "Login failed";
      setUser(payload.user);
      setRoleName(payload.roleName);
      setRoles(payload.roles);
      return null;
    },
    [],
  );

  const logout = useCallback(async () => {
    await post("/api/auth/logout", {});
    setUser(null);
    setRoleName(null);
    setRoles([]);
    router.replace("/login");
    router.refresh();
  }, [router]);

  const switchHat = useCallback(
    async (nextRole: string | null): Promise<string | null> => {
      const { ok, payload, error } = await post("/api/auth/hat", { roleName: nextRole });
      if (!ok) return error ?? "Could not switch hat";
      setUser(payload.user);
      setRoleName(payload.roleName);
      setRoles(payload.roles);
      return null;
    },
    [],
  );

  const value = useMemo<SessionState>(
    () => ({ user, roleName, roles, loading, login, logout, switchHat, refresh }),
    [user, roleName, roles, loading, login, logout, switchHat, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
