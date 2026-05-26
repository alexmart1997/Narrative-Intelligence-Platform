"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  GraphNode,
  IntelligenceMapCluster,
  IntelligenceMapResponse,
  SourceInfo,
  getIntelligenceMap,
  getSources
} from "@/lib/api";
import styles from "./page.module.css";

type MapMode = "narratives" | "events" | "sources";
type SelectedItem =
  | { type: "cluster"; cluster: IntelligenceMapCluster }
  | { type: "article"; node: GraphNode }
  | null;

const modeLabels: Record<MapMode, string> = {
  narratives: "Нарративы",
  events: "События",
  sources: "Источники"
};

export default function IntelligenceMapPage() {
  const [map, setMap] = useState<IntelligenceMapResponse | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [mode, setMode] = useState<MapMode>("narratives");
  const [sourceCode, setSourceCode] = useState("");
  const [language, setLanguage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadMap();
    void getSources().then(setSources).catch(() => setSources([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMap(nextMode = mode) {
    setLoading(true);
    setError(null);
    try {
      const data = await getIntelligenceMap({
        dateFrom,
        dateTo,
        sourceCode,
        language,
        mode: nextMode,
        limit: 300
      });
      setMap(data);
      setSelected(data.clusters[0] ? { type: "cluster", cluster: data.clusters[0] } : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить карту");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMap();
  }

  function changeMode(nextMode: MapMode) {
    setMode(nextMode);
    void loadMap(nextMode);
  }

  const topClusters = useMemo(() => (map?.clusters ?? []).slice(0, 6), [map]);
  const selectedClusterId = selected?.type === "cluster" ? selected.cluster.id : selected?.node.data.cluster_id;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">Назад к статьям</Link>
          <p className={styles.eyebrow}>Intelligence Map</p>
          <h1>Карта информационного поля</h1>
          <span>Точки показывают статьи, облака показывают плотность событий, нарративов или источников.</span>
        </div>
        <div className={styles.stats}>
          <div>
            <strong>{map?.stats.articles ?? "—"}</strong>
            <span>статей</span>
          </div>
          <div>
            <strong>{map?.stats.clusters ?? "—"}</strong>
            <span>кластеров</span>
          </div>
          <div>
            <strong>{map?.stats.sources ?? "—"}</strong>
            <span>источников</span>
          </div>
        </div>
      </header>

      <section className={styles.shell}>
        <section className={styles.mapPanel}>
          <div className={styles.toolbar}>
            <div className={styles.modeSwitch}>
              {(Object.keys(modeLabels) as MapMode[]).map((item) => (
                <button
                  className={mode === item ? styles.activeMode : ""}
                  key={item}
                  onClick={() => changeMode(item)}
                  type="button"
                >
                  {modeLabels[item]}
                </button>
              ))}
            </div>
            <form className={styles.filters} onSubmit={applyFilters}>
              <select value={sourceCode} onChange={(event) => setSourceCode(event.target.value)} aria-label="Источник">
                <option value="">Все источники</option>
                {sources.map((source) => <option key={source.code} value={source.code}>{source.name}</option>)}
              </select>
              <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Язык">
                <option value="">Все языки</option>
                <option value="ru">ru</option>
                <option value="en">en</option>
              </select>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Дата с" />
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Дата по" />
              <button type="submit">Обновить</button>
            </form>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}
          {loading ? <MapSkeleton /> : null}
          {map && !loading ? (
            <CorpusMap
              clusters={map.clusters}
              nodes={map.nodes}
              selectedClusterId={String(selectedClusterId ?? "")}
              onSelectCluster={(cluster) => setSelected({ type: "cluster", cluster })}
              onSelectNode={(node) => setSelected({ type: "article", node })}
            />
          ) : null}
        </section>

        <aside className={styles.sidePanel}>
          <section className={styles.inspector}>
            <p className={styles.panelKicker}>Inspector</p>
            <Details selected={selected} />
          </section>
          <section className={styles.clusterList}>
            <p className={styles.panelKicker}>Top communities</p>
            <h2>Крупные облака</h2>
            {topClusters.map((cluster) => (
              <button key={cluster.id} onClick={() => setSelected({ type: "cluster", cluster })}>
                <i style={{ background: cluster.color }} />
                <span>{cluster.count}</span>
                <strong>{cluster.label}</strong>
              </button>
            ))}
          </section>
        </aside>
      </section>
    </main>
  );
}

function CorpusMap({
  clusters,
  nodes,
  onSelectCluster,
  onSelectNode,
  selectedClusterId
}: {
  clusters: IntelligenceMapCluster[];
  nodes: GraphNode[];
  onSelectCluster: (cluster: IntelligenceMapCluster) => void;
  onSelectNode: (node: GraphNode) => void;
  selectedClusterId: string;
}) {
  return (
    <svg className={styles.mapCanvas} viewBox="0 0 1000 680" role="img" aria-label="Карта информационного поля">
      <defs>
        <radialGradient id="clusterGlow">
          <stop offset="0%" stopColor="white" stopOpacity="0.16" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      {clusters.map((cluster) => (
        <g key={cluster.id} className={cluster.id === selectedClusterId ? styles.selectedCluster : ""}>
          <circle
            cx={cluster.x}
            cy={cluster.y}
            fill={cluster.color}
            fillOpacity="0.11"
            r={cluster.radius}
            stroke={cluster.color}
            strokeOpacity="0.22"
            strokeWidth="1"
            onClick={() => onSelectCluster(cluster)}
          />
          <circle cx={cluster.x} cy={cluster.y} fill="url(#clusterGlow)" r={cluster.radius * 0.72} />
        </g>
      ))}
      {nodes.map((node) => (
        <circle
          className={styles.articleDot}
          cx={numberData(node, "x")}
          cy={numberData(node, "y")}
          fill={stringData(node, "color") || "#67e8f9"}
          key={node.id}
          r={numberData(node, "size") || 5}
          onClick={() => onSelectNode(node)}
        >
          <title>{node.label}</title>
        </circle>
      ))}
      {clusters.slice(0, 10).map((cluster) => (
        <g key={`${cluster.id}_label`} className={styles.clusterLabel} onClick={() => onSelectCluster(cluster)}>
          <rect
            x={cluster.x - 90}
            y={cluster.y - cluster.radius - 18}
            width="180"
            height="30"
            rx="7"
            fill={cluster.color}
            fillOpacity="0.82"
          />
          <text x={cluster.x} y={cluster.y - cluster.radius + 2} textAnchor="middle">
            {truncate(cluster.label, 28)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Details({ selected }: { selected: SelectedItem }) {
  if (!selected) {
    return <p className={styles.emptyText}>Выбери облако или точку, чтобы увидеть контекст.</p>;
  }
  if (selected.type === "cluster") {
    const cluster = selected.cluster;
    return (
      <div className={styles.details}>
        <span className={styles.badge}>{translateClusterType(cluster.type)}</span>
        <h2>{cluster.label}</h2>
        <dl>
          <dt>Материалов</dt>
          <dd>{cluster.count}</dd>
          <dt>Источники</dt>
          <dd>{Object.entries(cluster.sources).map(([name, count]) => `${name} ${count}`).join(" · ") || "—"}</dd>
          <dt>Ключевые участники</dt>
          <dd>{cluster.top_entities.join(", ") || "—"}</dd>
        </dl>
      </div>
    );
  }

  const node = selected.node;
  const articleId = numberData(node, "article_id");
  return (
    <div className={styles.details}>
      <span className={styles.badge}>{stringData(node, "source_name")}</span>
      <h2>{node.label}</h2>
      <p>{stringData(node, "summary")}</p>
      <dl>
        <dt>Кластер</dt>
        <dd>{stringData(node, "cluster_label")}</dd>
        <dt>Фрейминг</dt>
        <dd>{stringData(node, "framing") || "—"}</dd>
        <dt>Нарратив</dt>
        <dd>{stringData(node, "narrative_hypothesis") || "—"}</dd>
      </dl>
      {articleId ? (
        <div className={styles.detailActions}>
          <Link href={`/articles/${articleId}/graph`}>Открыть граф</Link>
          <Link href={`/articles/${articleId}/compare`}>Сравнить</Link>
        </div>
      ) : null}
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className={styles.skeleton}>
      <span />
      <span />
      <span />
    </div>
  );
}

function numberData(node: GraphNode, key: string) {
  const value = Number(node.data[key]);
  return Number.isFinite(value) ? value : 0;
}

function stringData(node: GraphNode, key: string) {
  const value = node.data[key];
  return typeof value === "string" ? value : "";
}

function translateClusterType(type: string) {
  const labels: Record<string, string> = {
    narrative: "Нарративное облако",
    event: "Событийное облако",
    source: "Источник"
  };
  return labels[type] ?? type;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
