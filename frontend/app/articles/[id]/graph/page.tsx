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
import { ArticleGraphResponse, GraphNode, getArticleGraph } from "@/lib/api";
import styles from "./page.module.css";

const nodeTypes = [
  { type: "article", label: "Article" },
  { type: "source", label: "Source" },
  { type: "person", label: "Person" },
  { type: "organization", label: "Organization" },
  { type: "country", label: "Country" },
  { type: "concept", label: "Concept" },
  { type: "narrative", label: "Narrative" }
];

export default function ArticleGraphPage() {
  const params = useParams<{ id: string }>();
  const articleId = params.id;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<ArticleGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const articleNode = graph?.nodes.find((node) => node.type === "article");
    return articleNode?.label ?? `Article ${articleId}`;
  }, [articleId, graph]);

  useEffect(() => {
    async function loadGraph() {
      setLoading(true);
      setError(null);
      try {
        const data = await getArticleGraph(Number(articleId));
        setGraph(data);
        setSelectedNode(data.nodes.find((node) => node.type === "article") ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить граф");
      } finally {
        setLoading(false);
      }
    }

    loadGraph();
  }, [articleId]);

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
        padding: 48
      },
      minZoom: 0.25,
      maxZoom: 2.5,
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
          <Link className={styles.backLink} href="/articles">
            Back to articles
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
          {loading ? <div className={styles.state}>Loading graph...</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
          <div ref={containerRef} className={styles.canvas} aria-label="Article graph canvas" />
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
        label: edge.data?.relation_type ? String(edge.data.relation_type) : edge.label,
        edgeType: edge.label
      }
    }))
  ];
}

function calculatePositions(nodes: GraphNode[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  const article = nodes.find((node) => node.type === "article");
  const source = nodes.find((node) => node.type === "source");
  const narrative = nodes.find((node) => node.type === "narrative");
  const entities = nodes.filter((node) => !["article", "source", "narrative"].includes(node.type));

  if (article) positions[article.id] = { x: 0, y: 0 };
  if (source) positions[source.id] = { x: -360, y: -220 };
  if (narrative) positions[narrative.id] = { x: 380, y: 260 };

  const radius = Math.max(260, entities.length * 42);
  entities.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(entities.length, 1) - Math.PI / 2;
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  });
  return positions;
}

function graphStyles(): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": "#7c8aa5",
        "border-color": "#ffffff",
        "border-width": 3,
        color: "#111827",
        "font-size": 13,
        "font-weight": 700,
        label: "data(label)",
        "text-background-color": "#ffffff",
        "text-background-opacity": 0.88,
        "text-background-padding": "4px",
        "text-max-width": 140,
        "text-wrap": "wrap",
        "text-valign": "bottom",
        "text-margin-y": 8,
        height: 48,
        shape: "ellipse",
        width: 48
      }
    },
    {
      selector: 'node[type = "article"]',
      style: {
        "background-color": "#2557d6",
        color: "#0f172a",
        height: 92,
        shape: "round-rectangle",
        width: 120
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
      selector: 'node[type = "concept"]',
      style: {
        "background-color": "#64748b",
        shape: "ellipse"
      }
    },
    {
      selector: 'node[type = "narrative"]',
      style: {
        "background-color": "#e11d48",
        shape: "round-tag",
        width: 110
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
      selector: 'edge[edgeType = "sympathizes_with"]',
      style: {
        "line-color": "#16a34a",
        "target-arrow-color": "#16a34a"
      }
    },
    {
      selector: 'edge[edgeType = "criticizes"]',
      style: {
        "line-color": "#dc2626",
        "target-arrow-color": "#dc2626"
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
