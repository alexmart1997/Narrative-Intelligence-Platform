"use client";

import cytoscape, {
  Core,
  ElementDefinition,
  EventObject,
  NodeSingular,
  StylesheetJson
} from "cytoscape";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleGraphResponse, GraphNode, getNarrativeGraph } from "@/lib/api";
import styles from "./page.module.css";

const nodeTypes = [
  { type: "narrative", label: "Narrative" },
  { type: "article", label: "Article" },
  { type: "source", label: "Source" },
  { type: "person", label: "Person" },
  { type: "organization", label: "Organization" },
  { type: "country", label: "Country" },
  { type: "location", label: "Location" },
  { type: "concept", label: "Concept" }
];

export default function NarrativeGraphPage() {
  const params = useParams<{ id: string }>();
  const narrativeId = params.id;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<ArticleGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const narrative = graph?.nodes.find((node) => node.type === "narrative");
    return narrative?.label ?? `Narrative ${narrativeId}`;
  }, [graph, narrativeId]);

  useEffect(() => {
    async function loadGraph() {
      setLoading(true);
      setError(null);
      try {
        const data = await getNarrativeGraph(Number(narrativeId));
        setGraph(data);
        setSelectedNode(data.nodes.find((node) => node.type === "narrative") ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить граф нарратива");
      } finally {
        setLoading(false);
      }
    }

    loadGraph();
  }, [narrativeId]);

  useEffect(() => {
    if (!graph || !containerRef.current) {
      return;
    }

    cyRef.current?.destroy();
    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph),
      style: graphStyles(),
      layout: {
        name: "preset",
        fit: true,
        padding: 58
      },
      minZoom: 0.22,
      maxZoom: 2.6,
      wheelSensitivity: 0.18
    });

    cy.on("tap", "node", (event: EventObject) => {
      const node = event.target as NodeSingular;
      const graphNode = graph.nodes.find((item) => item.id === node.id());
      setSelectedNode(graphNode ?? null);
    });

    cy.on("tap", (event: EventObject) => {
      if (event.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;
    return () => cy.destroy();
  }, [graph]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/narratives">
            Back to narratives
          </Link>
          <h1>{title}</h1>
        </div>
        <div className={styles.stats}>
          {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : "Graph"}
        </div>
      </header>

      <section className={styles.shell}>
        <aside className={styles.legend}>
          <h2>Legend</h2>
          <ul>
            {nodeTypes.map((item) => (
              <li key={item.type}>
                <span className={`${styles.legendDot} ${styles[item.type]}`} />
                {item.label}
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.canvasWrap}>
          {loading ? <div className={styles.state}>Loading narrative graph...</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
          <div ref={containerRef} className={styles.canvas} aria-label="Narrative graph canvas" />
        </section>

        <aside className={styles.detailPanel}>
          <h2>Node details</h2>
          {selectedNode ? (
            <div className={styles.details}>
              <span className={`${styles.badge} ${styles[selectedNode.type]}`}>{selectedNode.type}</span>
              <h3>{selectedNode.label}</h3>
              <dl>
                <dt>ID</dt>
                <dd>{selectedNode.id}</dd>
              </dl>
              <pre>{JSON.stringify(selectedNode.data, null, 2)}</pre>
            </div>
          ) : (
            <p className={styles.hint}>Click a node to inspect its details.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function toElements(graph: ArticleGraphResponse): ElementDefinition[] {
  const positions = calculatePositions(graph.nodes);
  return [
    ...graph.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        type: node.type
      },
      position: positions[node.id]
    })),
    ...graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        edgeType: edge.label
      }
    }))
  ];
}

function calculatePositions(nodes: GraphNode[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  const narrative = nodes.find((node) => node.type === "narrative");
  const articles = nodes.filter((node) => node.type === "article");
  const sources = nodes.filter((node) => node.type === "source");
  const entities = nodes.filter((node) => !["article", "source", "narrative"].includes(node.type));

  if (narrative) positions[narrative.id] = { x: 0, y: 0 };
  placeOnCircle(positions, articles, 290, -Math.PI / 2);
  placeOnCircle(positions, sources, 460, Math.PI / 3);
  placeOnCircle(positions, entities, Math.max(520, entities.length * 36), Math.PI / 5);
  return positions;
}

function placeOnCircle(
  positions: Record<string, { x: number; y: number }>,
  nodes: GraphNode[],
  radius: number,
  offset: number
) {
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) + offset;
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  });
}

function graphStyles(): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": "#64748b",
        "border-color": "#ffffff",
        "border-width": 3,
        color: "#111827",
        "font-size": 12,
        "font-weight": 800,
        label: "data(label)",
        "text-background-color": "#ffffff",
        "text-background-opacity": 0.9,
        "text-background-padding": "4px",
        "text-max-width": 150,
        "text-wrap": "wrap",
        "text-valign": "bottom",
        "text-margin-y": 8,
        height: 48,
        shape: "ellipse",
        width: 48
      }
    },
    {
      selector: 'node[type = "narrative"]',
      style: {
        "background-color": "#e11d48",
        height: 118,
        shape: "round-tag",
        width: 150
      }
    },
    {
      selector: 'node[type = "article"]',
      style: {
        "background-color": "#2557d6",
        height: 82,
        shape: "round-rectangle",
        width: 118
      }
    },
    {
      selector: 'node[type = "source"]',
      style: {
        "background-color": "#16a34a",
        shape: "diamond"
      }
    },
    {
      selector: 'node[type = "person"]',
      style: { "background-color": "#f59e0b" }
    },
    {
      selector: 'node[type = "organization"]',
      style: {
        "background-color": "#8b5cf6",
        shape: "round-rectangle"
      }
    },
    {
      selector: 'node[type = "country"]',
      style: {
        "background-color": "#06b6d4",
        shape: "hexagon"
      }
    },
    {
      selector: 'node[type = "location"]',
      style: {
        "background-color": "#0ea5e9",
        shape: "vee"
      }
    },
    {
      selector: 'node[type = "concept"]',
      style: {
        "background-color": "#64748b",
        shape: "ellipse"
      }
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "font-size": 11,
        "line-color": "#a8b3c7",
        "target-arrow-color": "#a8b3c7",
        "target-arrow-shape": "triangle",
        color: "#334155",
        label: "data(label)",
        "text-background-color": "#f7f8fb",
        "text-background-opacity": 0.92,
        "text-background-padding": "3px",
        width: 2
      }
    },
    {
      selector: 'edge[edgeType = "supports_narrative"]',
      style: {
        "line-color": "#e11d48",
        "target-arrow-color": "#e11d48",
        width: 3
      }
    },
    {
      selector: "node:selected",
      style: {
        "border-color": "#111827",
        "border-width": 5
      }
    }
  ] as StylesheetJson;
}
