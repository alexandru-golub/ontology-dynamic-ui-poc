"use client";

import { gql, useQuery } from "@apollo/client";
import { useState } from "react";
import { SurfaceRenderer } from "@/components/surface-renderer";

const MY_SURFACES = gql`
  query MySurfaces {
    mySurfaces {
      id
      name
      renderer
      icon
      entity
      config { columns search defaultSort actions }
      permissions { read create update delete }
    }
  }
`;

type Surface = {
  id: string;
  name: string;
  renderer: string;
  icon?: string;
  entity: string;
  config: { columns: string[]; search: string[]; defaultSort: string; actions: string[] };
  permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
};

export default function Home() {
  const { data, loading, error } = useQuery<{ mySurfaces: Surface[] }>(MY_SURFACES);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string>();
  const surface = data?.mySurfaces.find((item) => item.id === selectedSurfaceId) ?? data?.mySurfaces[0];

  return (
    <main className="shell">
      <aside>
        <div className="brand"><span>◈</span> Graph Surfaces</div>
        <p className="eyebrow">Available to John</p>
        <nav>
          {data?.mySurfaces.map((item) => <a key={item.id} href={`#${item.id}`} onClick={() => setSelectedSurfaceId(item.id)}>{item.icon === "users" ? "♙" : "◌"} {item.name}</a>)}
        </nav>
        <div className="aside-note">Definitions, roles, and permissions live in Neo4j. Renderers remain application code.</div>
      </aside>
      <section className="workspace">
        <header><div><p className="eyebrow">Graph-driven workspace</p><h1>{surface?.name ?? "Loading surfaces…"}</h1></div><span className="identity">John Editor</span></header>
        {loading && <div className="state">Loading surface configuration from Neo4j…</div>}
        {error && <div className="state error">{error.message}<br />Start Neo4j and run <code>npm run seed</code>.</div>}
        {surface && <SurfaceRenderer surface={surface} />}
      </section>
    </main>
  );
}
