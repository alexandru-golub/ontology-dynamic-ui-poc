"use client";

import { gql, useApolloClient, useQuery } from "@apollo/client";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPanel } from "@/components/admin-panel";
import { useSession } from "@/components/session-provider";
import { DynamicSurface } from "@/components/surface-renderer";
import { SurfacesNav } from "@/components/surfaces-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const LIST_SURFACES = gql`
  query ListSurfaces {
    listSurfaces {
      id
      title
    }
  }
`;

export default function Home() {
  const { user, roleName, roles, loading, logout, switchHat } = useSession();
  const client = useApolloClient();
  const [view, setView] = useState<"surface" | "admin">("surface");
  const [surfaceId, setSurfaceId] = useState("projects");
  const [surfaceTitle, setSurfaceTitle] = useState("Project Overview");
  const [hatOpen, setHatOpen] = useState(false);
  const [hatError, setHatError] = useState<string | null>(null);

  // Refetch identity-dependent queries when the acting hat changes.
  useEffect(() => {
    void client.refetchQueries({ include: ["ListSurfaces"] });
  }, [client, roleName]);

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

  const pickHat = async (next: string | null) => {
    setHatError(null);
    const error = await switchHat(next);
    if (error) {
      setHatError(error);
      return;
    }
    setHatOpen(false);
    setSurfaceId("projects");
    setSurfaceTitle("Project Overview");
  };

  if (loading) {
    return (
      <main className="shell">
        <p className="state">Loading session…</p>
      </main>
    );
  }
  if (!user) return null; // middleware + session check will bounce to /login

  const isAdmin = user.isAdmin;
  const hatLabel = roleName ?? "All hats";

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>◈</span>Graph Surfaces
        </div>
        <p className="eyebrow">Surfaces</p>
        <div key={`${user.id}:${roleName}`}>
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
          Surfaces, columns, rows, hats and permissions live in Neo4j. The UI re-renders from whatever the
          graph defines for the hat you are wearing.
        </p>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">{view === "admin" ? "Super admin" : "GraphQL dynamic projection"}</p>
            <h1>{view === "admin" ? "Admin console" : surfaceTitle}</h1>
          </div>
          <div className="identity">
            <Badge variant="outline" className="font-mono text-[10px]">
              {user.id}
            </Badge>
            <span className="text-sm font-medium">{user.name}</span>
            <Button size="sm" variant="outline" onClick={() => setHatOpen(true)} title="Switch the hat (role) this session wears">
              🎩 {hatLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void logout()} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>
        {view === "admin" ? (
          <div key={`${user.id}:${roleName}`}>
            <AdminPanel onOpenSurface={openSurface} />
          </div>
        ) : (
          <div key={`${user.id}:${roleName}:${surfaceId}`}>
            <DynamicSurface surfaceId={surfaceId} />
          </div>
        )}
      </section>

      {/* ---------------- Hat switcher ---------------- */}
      <Dialog open={hatOpen} onOpenChange={setHatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch hat</DialogTitle>
            <DialogDescription>
              Hats are roles — each has its own surfaces and permissions. Wearing one restricts this session to
              what that hat can see. “All hats” merges every role you hold.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              onClick={() => void pickHat(null)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${
                hatLabel === "All hats" ? "border-primary bg-muted" : "border-border"
              }`}
            >
              <span className="font-medium">All hats</span>
              <span className="block text-xs text-muted-foreground">Union of every role you hold</span>
            </button>
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => void pickHat(role)}
                className={`block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${
                  roleName === role ? "border-primary bg-muted" : "border-border"
                }`}
              >
                🎩 {role}
              </button>
            ))}
            {roles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                You hold no roles yet — an admin can assign you hats in the Admin console.
              </p>
            )}
            {hatError && <p className="text-sm text-destructive">{hatError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHatOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
