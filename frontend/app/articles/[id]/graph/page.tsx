"use client";

import cytoscape, {
  Core,
  ElementDefinition,
  EventObject,
  NodeSingular,
  StylesheetJson
} from "cytoscape";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArticleGraphResponse,
  GraphEdge,
  GraphNode,
  analyzeArticle,
  detectArticleEvent,
  embedArticle,
  getArticleGraph
} from "@/lib/api";
import styles from "./page.module.css";

const nodeTypes = [
  { type: "article", label: "Статья" },
  { type: "source", label: "Источник" },
  { type: "person", label: "Персона" },
  { type: "organization", label: "Организация" },
  { type: "country", label: "Страна" },
  { type: "location", label: "Локация" },
  { type: "concept", label: "Концепт" },
  { type: "narrative", label: "Нарратив" }
];

const edgeLabels: Record<string, string> = {
  published_by: "опубликовано",
  mentions: "упоминает",
  relates_to: "связано с",
  sympathizes_with: "симпатизирует",
  criticizes: "критикует",
  supports_narrative: "поддерживает нарратив",
  same_event_as: "то же событие",
  similar_to: "похожая статья",
  shares_narrative: "общий нарратив"
};

export default function ArticleGraphPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const initialArticleId = Number(params.id);
  const [activeArticleId, setActiveArticleId] = useState(initialArticleId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<ArticleGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const articleNode = graph?.nodes.find((node) => node.id === `article_${activeArticleId}`);
    return articleNode?.label ?? `Статья ${activeArticleId}`;
  }, [activeArticleId, graph]);

  const relatedCount = useMemo(() => {
    if (!graph) return 0;
    return graph.nodes.filter((node) => node.type === "article" && node.id !== `article_${activeArticleId}`).length;
  }, [activeArticleId, graph]);

  useEffect(() => {
    setActiveArticleId(initialArticleId);
  }, [initialArticleId]);

  useEffect(() => {
    loadGraph(activeArticleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArticleId]);

  useEffect(() => {
    if (!graph || !containerRef.current) {
      return;
    }

    cyRef.current?.destroy();
    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph, activeArticleId),
      style: graphStyles(),
      layout: {
        name: "cose",
        animate: true,
        animationDuration: 700,
        fit: true,
        padding: 72,
        nodeRepulsion: 120000,
        idealEdgeLength: 150,
        edgeElasticity: 90,
        gravity: 0.08,
        numIter: 900
      },
      minZoom: 0.18,
      maxZoom: 3,
      wheelSensitivity: 0.16
    });

    cy.on("tap", "node", (event: EventObject) => {
      const node = event.target as NodeSingular;
      const graphNode = graph.nodes.find((item) => item.id === node.id());
      setSelectedNode(graphNode ?? null);
      setSelectedEdge(null);

      // Клик по связанной статье переносит пользователя в ее собственный граф.
      const nodeArticleId = Number(graphNode?.data?.article_id);
      if (graphNode?.type === "article" && Number.isFinite(nodeArticleId) && nodeArticleId !== activeArticleId) {
        setActiveArticleId(nodeArticleId);
        router.replace(`/articles/${nodeArticleId}/graph`);
      }
    });

    cy.on("tap", "edge", (event: EventObject) => {
      const edgeId = event.target.id();
      setSelectedEdge(graph.edges.find((item) => item.id === edgeId) ?? null);
      setSelectedNode(null);
    });

    cy.on("tap", (event: EventObject) => {
      if (event.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    });

    cyRef.current = cy;
    return () => cy.destroy();
  }, [activeArticleId, graph, router]);

  async function loadGraph(articleId: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await getArticleGraph(articleId, { includeRelated: true, limitRelated: 20 });
      setGraph(data);
      setSelectedEdge(null);
      setSelectedNode(data.nodes.find((node) => node.id === `article_${articleId}`) ?? null);
    } catch (caught) {
      setGraph(null);
      setSelectedNode(null);
      setSelectedEdge(null);
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить граф");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeAndReload() {
    setProcessing(true);
    setError(null);
    try {
      await analyzeArticle(activeArticleId);
      await embedArticle(activeArticleId);
      await detectArticleEvent(activeArticleId);
      await loadGraph(activeArticleId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setProcessing(false);
    }
  }

  function rerunLayout() {
    cyRef.current?.layout({
      name: "cose",
      animate: true,
      animationDuration: 600,
      fit: true,
      padding: 72,
      nodeRepulsion: 120000,
      idealEdgeLength: 150,
      gravity: 0.08,
      numIter: 700
    }).run();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Назад к статьям
          </Link>
          <p className={styles.eyebrow}>Интерактивная карта связей</p>
          <h1>{title}</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.stats}>
            {graph ? `${graph.nodes.length} узлов · ${graph.edges.length} связей · ${relatedCount} связанных статей` : "Граф"}
          </span>
          <button onClick={rerunLayout} disabled={!graph || loading}>
            Перестроить
          </button>
          <button onClick={() => loadGraph(activeArticleId)} disabled={loading || processing}>
            Обновить
          </button>
        </div>
      </header>

      <section className={styles.shell}>
        <aside className={styles.legend}>
          <h2>Легенда</h2>
          <ul>
            {nodeTypes.map((item) => (
              <li key={item.type}>
                <span className={`${styles.legendDot} ${styles[item.type]}`} />
                {item.label}
              </li>
            ))}
          </ul>

          <div className={styles.edgeLegend}>
            <h3>Типы связей</h3>
            {Object.entries(edgeLabels).map(([key, value]) => (
              <span key={key}>{value}</span>
            ))}
          </div>
        </aside>

        <section className={styles.canvasWrap}>
          {loading ? <div className={styles.state}>Загружаю граф...</div> : null}
          {processing ? <div className={styles.state}>Выполняю анализ, embedding и event matching...</div> : null}
          {error ? (
            <div className={styles.error}>
              <strong>{error}</strong>
              {error.includes("LLM-анализ") || error.includes("Анализ статьи не найден") ? (
                <button onClick={analyzeAndReload} disabled={processing}>
                  {processing ? "Анализируется..." : "Запустить анализ и построить граф"}
                </button>
              ) : null}
            </div>
          ) : null}
          <div ref={containerRef} className={styles.canvas} aria-label="Интерактивный граф статьи" />
        </section>

        <aside className={styles.detailPanel}>
          <h2>Детали</h2>
          {selectedNode ? <NodeDetails node={selectedNode} currentArticleId={activeArticleId} /> : null}
          {selectedEdge ? <EdgeDetails edge={selectedEdge} /> : null}
          {!selectedNode && !selectedEdge ? (
            <p className={styles.hint}>
              Кликни по узлу или связи. Узлы можно перетаскивать, колесом менять масштаб,
              а клик по связанной статье откроет ее собственную сеть.
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function NodeDetails({ currentArticleId, node }: { currentArticleId: number; node: GraphNode }) {
  const articleId = Number(node.data.article_id);
  return (
    <div className={styles.details}>
      <span className={`${styles.badge} ${styles[node.type]}`}>{translateNodeType(node.type)}</span>
      <h3>{node.label}</h3>
      {node.type === "article" && Number.isFinite(articleId) && articleId !== currentArticleId ? (
        <p className={styles.hint}>Клик по этой статье перестроит граф вокруг нее.</p>
      ) : null}
      <dl>
        <dt>ID</dt>
        <dd>{node.id}</dd>
        {Object.entries(node.data).map(([key, value]) => (
          <DisplayValue key={key} label={translateDataKey(key)} value={value} />
        ))}
      </dl>
    </div>
  );
}

function EdgeDetails({ edge }: { edge: GraphEdge }) {
  return (
    <div className={styles.details}>
      <span className={styles.edgeBadge}>{translateEdge(edge.label)}</span>
      <h3>{translateEdge(edge.label)}</h3>
      <dl>
        <dt>Откуда</dt>
        <dd>{edge.source}</dd>
        <dt>Куда</dt>
        <dd>{edge.target}</dd>
        {Object.entries(edge.data).map(([key, value]) => (
          <DisplayValue key={key} label={translateDataKey(key)} value={value} />
        ))}
      </dl>
    </div>
  );
}

function DisplayValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{typeof value === "number" ? formatNumber(value) : String(value)}</dd>
    </>
  );
}

function toElements(graph: ArticleGraphResponse, activeArticleId: number): ElementDefinition[] {
  return [
    ...graph.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        type: node.type,
        focus: node.id === `article_${activeArticleId}` ? "true" : "false",
        relationHint: typeof node.data.relation_hint === "string" ? node.data.relation_hint : ""
      }
    })),
    ...graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.data?.relation_type ? String(edge.data.relation_type) : translateEdge(edge.label),
        edgeType: edge.label
      }
    }))
  ];
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
        "font-size": 12,
        "font-weight": 700,
        label: "data(label)",
        "min-zoomed-font-size": 7,
        "overlay-padding": 6,
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
      selector: 'node[type = "article"]',
      style: {
        "background-color": "#2563eb",
        height: 82,
        shape: "round-rectangle",
        width: 118
      }
    },
    {
      selector: 'node[focus = "true"]',
      style: {
        "background-color": "#0f172a",
        "border-color": "#38bdf8",
        "border-width": 6,
        height: 112,
        width: 150
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
        "background-color": "#7c3aed",
        shape: "round-rectangle"
      }
    },
    {
      selector: 'node[type = "country"]',
      style: {
        "background-color": "#0891b2",
        shape: "hexagon"
      }
    },
    {
      selector: 'node[type = "location"]',
      style: {
        "background-color": "#0d9488",
        shape: "tag"
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
        width: 120
      }
    },
    {
      selector: 'node[relationHint = "same_event"]',
      style: {
        "border-color": "#10b981",
        "border-width": 5
      }
    },
    {
      selector: 'node[relationHint = "qdrant_similarity"]',
      style: {
        "border-color": "#38bdf8",
        "border-width": 5
      }
    },
    {
      selector: 'node[relationHint = "narrative_similarity"]',
      style: {
        "border-color": "#f43f5e",
        "border-width": 5
      }
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "font-size": 10,
        "line-color": "#a8b3c7",
        "target-arrow-color": "#a8b3c7",
        "target-arrow-shape": "triangle",
        color: "#334155",
        label: "data(label)",
        "min-zoomed-font-size": 7,
        "text-background-color": "#f7f8fb",
        "text-background-opacity": 0.94,
        "text-background-padding": "3px",
        width: 2
      }
    },
    {
      selector: 'edge[edgeType = "same_event_as"]',
      style: {
        "line-color": "#10b981",
        "target-arrow-color": "#10b981",
        width: 4
      }
    },
    {
      selector: 'edge[edgeType = "similar_to"]',
      style: {
        "line-color": "#38bdf8",
        "target-arrow-color": "#38bdf8",
        "line-style": "dashed"
      }
    },
    {
      selector: 'edge[edgeType = "shares_narrative"]',
      style: {
        "line-color": "#f43f5e",
        "target-arrow-color": "#f43f5e",
        "line-style": "dotted"
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
      selector: "node:selected, edge:selected",
      style: {
        "border-color": "#111827",
        "line-color": "#111827",
        "target-arrow-color": "#111827",
        "border-width": 5,
        width: 5
      }
    }
  ] as StylesheetJson;
}

function translateNodeType(type: string) {
  return nodeTypes.find((item) => item.type === type)?.label ?? type;
}

function translateEdge(label: string) {
  return edgeLabels[label] ?? label;
}

function translateDataKey(key: string) {
  const labels: Record<string, string> = {
    article_id: "ID статьи",
    source_id: "ID источника",
    source_name: "Источник",
    entity_id: "ID сущности",
    analysis_id: "ID анализа",
    event_id: "ID события",
    url: "Ссылка",
    published_at: "Дата публикации",
    language: "Язык",
    role: "Роль",
    importance_score: "Важность",
    confidence: "Уверенность",
    same_event_probability: "Вероятность того же события",
    score: "Похожесть",
    similarity: "Сходство нарратива",
    relation_type: "Тип отношения",
    description: "Описание",
    relation_hint: "Причина связи",
    synthetic: "Создано из вывода LLM",
    polarity: "Полярность",
    type: "Тип"
  };
  return labels[key] ?? key;
}

function formatNumber(value: number) {
  if (value > 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return String(value);
}
