"use client";

import { gql, useApolloClient, useQuery } from "@apollo/client";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPanel } from "@/components/admin-panel";
import { DEMO_USERS, useDemoUser } from "@/components/apollo-provider";
import { DynamicSurface } from "@/components/surface-renderer";
import { SurfacesNav } from "@/components/surfaces-nav";

const ME = gql`
  query Me {
    me {
      id
      name
      isAdmin
    }
  }
`;

export default function Home() {
  const { user, setUser } = useDemoUser();
  const { data: meData } = useQuery<{ me: { id: string; name: string; isAdmin: boolean } }>(ME, {
    fetchPolicy: "no-cache",
  });
  const client = useApolloClient();

  // Refetch identity when the acting user changes (the server keys on the x-user-id header).
  useEffect(() => {
    void client.refetchQueries({ include: ["Me"] });
  }, [client, user.id]);

  const isAdmin = meData?.me.isAdmin ?? false;

  const [view, setView] = useState<"surface" | "admin">("surface");
  const [surfaceId, setSurfaceId] = useState("projects");
  const [surfaceTitle, setSurfaceTitle] = useState("Project Overview");

  // Keep the header in sync when a surface is renamed from the manage dialog.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ title: string }>).detail;
      if (detail?.title) setSurfaceTitle(detail.title);
    };
    window.addEventListener("surface-renamed", handler);
    return () => window.removeEventListener("surface-renamed", handler);
  }, []);

  const openSurface = (id: string, title: string) => {
    setSurfaceId(id);
    setSurfaceTitle(title);
    setView("surface");
  };

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>◈</span>Graph Surfaces
        </div>
        <p className="eyebrow">Surfaces</p>
        <div key={user.id}>
          <SurfacesNav
            activeSurfaceId={view === "surface" ? surfaceId : null}
            onSelect={(surface) => openSurface(surface.id, surface.title)}
          />
        </div>
        {isAdmin && (
          <nav>
            <button className={`nav-admin ${view === "admin" ? "nav-active" : ""}`} onClick={() => setView("admin")}>
              <ShieldCheck style={{ verticalAlign: "-2px", marginRight: 6, width: 15, height: 15 }} />
              Admin console
            </button>
          </nav>
        )}
        <p className="aside-note">
          Surfaces, columns, rows and permissions live in Neo4j. The UI re-renders from whatever the
          graph defines for the signed-in user.
        </p>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">{view === "admin" ? "Super admin" : "GraphQL dynamic projection"}</p>
            <h1>{view === "admin" ? "Admin console" : surfaceTitle}</h1>
          </div>
          <div className="identity">
            <label htmlFor="user-switch">Acting as </label>
            <select
              id="user-switch"
              value={user.id}
              onChange={(event) => {
                const next = DEMO_USERS.find((u) => u.id === event.target.value);
                if (next) setUser(next);
              }}
            >
              {DEMO_USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role}
                </option>
              ))}
            </select>
          </div>
        </header>
        {view === "admin" ? (
          <div key={user.id}>
            <AdminPanel onOpenSurface={openSurface} />
          </div>
        ) : (
          <div key={`${user.id}:${surfaceId}`}>
            <DynamicSurface surfaceId={surfaceId} />
          </div>
        )}
      </section>
    </main>
  );
}
