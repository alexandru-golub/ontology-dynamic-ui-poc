"use client";

import { gql, useQuery } from "@apollo/client";

const LIST_SURFACES = gql`
  query ListSurfaces {
    listSurfaces {
      id
      title
      renderer
    }
  }
`;

type SurfaceSummary = { id: string; title: string; renderer: string };

export function SurfacesNav({
  activeSurfaceId,
  onSelect,
}: {
  activeSurfaceId: string | null;
  onSelect: (surface: SurfaceSummary) => void;
}) {
  const { data, loading, error } = useQuery<{ listSurfaces: SurfaceSummary[] }>(LIST_SURFACES, {
    fetchPolicy: "no-cache",
  });

  if (loading) {
    return (
      <nav>
        <button disabled>Loading surfaces…</button>
      </nav>
    );
  }

  if (error || !data?.listSurfaces?.length) {
    return (
      <nav>
        <button disabled>No surfaces available</button>
      </nav>
    );
  }

  return (
    <nav>
      {data.listSurfaces.map((surface) => (
        <button
          key={surface.id}
          className={surface.id === activeSurfaceId ? "nav-active" : ""}
          onClick={() => onSelect(surface)}
        >
          {surface.title}
        </button>
      ))}
    </nav>
  );
}
