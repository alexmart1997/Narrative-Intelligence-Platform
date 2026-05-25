"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { GraphBreadcrumbs } from "@/components/graph/GraphBreadcrumbs";
import { GraphControls } from "@/components/graph/GraphControls";
import { GraphDetailsPanel, buildNarrativeSignals } from "@/components/graph/GraphDetailsPanel";
import { GraphModes } from "@/components/graph/GraphModes";
import { graphNodeLabel } from "@/components/graph/graphEncoding";
import { createThreeGraphScene } from "@/components/graph/graphScene";
import { CameraMode, GraphMode, SceneApi, VisualFilters, entityNodeTypes } from "@/components/graph/types";
import {
  ArticleGraphResponse,
  GraphEdge,
  GraphNode,
  JobResponse,
  getArticleGraph,
  getJob,
  startAnalyzeJob
} from "@/lib/api";
import styles from "./page.module.css";

const defaultFilters: VisualFilters = {
  showEntities: true,
  showArticles: true,
  showSources: true,
  showNarratives: true,
  showWeakEdges: false,
  confidenceThreshold: 0,
  labelDensity: 0.32
};

export default function ArticleGraphPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const initialArticleId = Number(params.id);
  const [activeArticleId, setActiveArticleId] = useState(initialArticleId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [graph, setGraph] = useState<ArticleGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [focusEntity, setFocusEntity] = useState<{ id: number; name: string } | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("article");
  const [filters, setFilters] = useState<VisualFilters>(defaultFilters);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("free");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const articleNode = graph?.nodes.find((node) => node.id === `article_${activeArticleId}`);
    return graphNodeLabel(articleNode) || `Статья ${activeArticleId}`;
  }, [activeArticleId, graph]);

  const relatedCount = useMemo(() => {
    if (!graph) return 0;
    return graph.nodes.filter((node) => node.type === "article" && node.id !== `article_${activeArticleId}`).length;
  }, [activeArticleId, graph]);

  const narrativeSignals = useMemo(() => buildNarrativeSignals(graph), [graph]);

  useEffect(() => {
    setActiveArticleId(initialArticleId);
    setFocusEntity(null);
  }, [initialArticleId]);

  useEffect(() => {
    loadGraph(activeArticleId, focusEntity?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArticleId, focusEntity?.id]);

  useEffect(() => {
    if (!graph || !containerRef.current) return;

    sceneApiRef.current?.dispose();
    sceneApiRef.current = createThreeGraphScene({
      activeArticleId,
      container: containerRef.current,
      graph,
      mode: graphMode,
      filters,
      autoOrbit,
      focusMode,
      selectedNodeId: selectedNode?.id ?? null,
      cameraMode,
      onEdgeSelect: (edge) => {
        setSelectedEdge(edge);
        setSelectedNode(null);
      },
      onNodeSelect: handleNodeSelect
    });

    return () => {
      sceneApiRef.current?.dispose();
      sceneApiRef.current = null;
    };
    // Пересоздаем сцену только когда меняется граф/режим/фильтры, а не на hover.
  }, [activeArticleId, autoOrbit, cameraMode, filters, focusMode, graph, graphMode, selectedNode?.id]);

  async function loadGraph(articleId: number, focusEntityId: number | null = focusEntity?.id ?? null) {
    setLoading(true);
    setError(null);
    try {
      const data = await getArticleGraph(articleId, {
        includeRelated: true,
        limitRelated: 14,
        focusEntityId
      });
      setGraph(data);
      setSelectedEdge(null);
      setSelectedNode(
        data.nodes.find((node) => Boolean(node.data.is_focus))
        ?? data.nodes.find((node) => node.id === `article_${articleId}`)
        ?? null
      );
    } catch (caught) {
      setGraph(null);
      setSelectedNode(null);
      setSelectedEdge(null);
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить граф");
    } finally {
      setLoading(false);
    }
  }

  function handleNodeSelect(node: GraphNode) {
    setSelectedNode(node);
    setSelectedEdge(null);

    const nodeArticleId = Number(node.data.article_id);
    if (node.type === "article" && Number.isFinite(nodeArticleId) && nodeArticleId !== activeArticleId) {
      setFocusEntity(null);
      setActiveArticleId(nodeArticleId);
      router.replace(`/articles/${nodeArticleId}/graph`);
      return;
    }

    const entityId = Number(node.data.entity_id);
    if (entityNodeTypes.has(node.type) && Number.isFinite(entityId)) {
      setGraphMode("entity");
      setFocusEntity({ id: entityId, name: node.label });
    }
  }

  async function analyzeAndReload() {
    setProcessing(true);
    setProcessingMessage("Ставлю анализ в фоновую очередь...");
    setError(null);
    try {
      const job = await startAnalyzeJob(activeArticleId);
      await waitForJobCompletion(job.id, setProcessingMessage);
      await loadGraph(activeArticleId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setProcessing(false);
      setProcessingMessage(null);
    }
  }

  function updateFilter<K extends keyof VisualFilters>(key: K, value: VisualFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFocusEntity() {
    setGraphMode("article");
    setFocusEntity(null);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Назад к статьям
          </Link>
          <p className={styles.eyebrow}>3D-граф связей</p>
          <h1>{title}</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.stats}>
            {graph ? `${graph.nodes.length} узлов · ${graph.edges.length} связей · ${relatedCount} связанных статей` : "3D граф"}
          </span>
          <button onClick={() => sceneApiRef.current?.resetView()} disabled={!graph || loading}>
            Сброс
          </button>
          <button onClick={() => sceneApiRef.current?.topDown()} disabled={!graph || loading}>
            Сверху
          </button>
          <button className={autoOrbit ? styles.activeButton : ""} onClick={() => setAutoOrbit((value) => !value)} disabled={!graph || loading}>
            Орбита
          </button>
          <button className={focusMode ? styles.activeButton : ""} onClick={() => setFocusMode((value) => !value)} disabled={!graph || loading}>
            Фокус
          </button>
          {focusEntity ? (
            <button onClick={resetFocusEntity} disabled={loading || processing}>
              Вернуться к статье
            </button>
          ) : null}
          <button onClick={() => loadGraph(activeArticleId)} disabled={loading || processing}>
            Обновить
          </button>
        </div>
      </header>

      <section className={styles.shell}>
        <section className={styles.canvasWrap}>
          <GraphModes mode={graphMode} onChange={setGraphMode} styles={styles} />
          <GraphControls filters={filters} updateFilter={updateFilter} styles={styles} />
          <GraphBreadcrumbs focusEntity={focusEntity} onReset={resetFocusEntity} styles={styles} />
          {graph && relatedCount === 0 ? (
            <div className={styles.insight}>
              Связанные статьи не показаны: похожесть ниже порога 0.55 или для соседних статей еще нет анализа.
            </div>
          ) : null}
          {loading ? <div className={styles.state}>Загружаю 3D-граф...</div> : null}
          {processing ? <div className={styles.state}>{processingMessage ?? "Фоновая задача выполняется..."}</div> : null}
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
          <div ref={containerRef} className={styles.canvas} aria-label="3D граф статьи" />
        </section>

        <GraphDetailsPanel
          currentArticleId={activeArticleId}
          selectedEdge={selectedEdge}
          selectedNode={selectedNode}
          signals={narrativeSignals}
          styles={styles}
        />
      </section>
    </main>
  );
}

async function waitForJobCompletion(
  jobId: number,
  onUpdate: (message: string) => void
) {
  for (;;) {
    await delay(1800);
    const job = await getJob(jobId);
    onUpdate(`Задача #${job.id}: ${translateJobStatus(job.status)} · ${Math.round(job.progress * 100)}% · ${latestJobMessage(job)}`);
    if (job.status === "completed") return;
    if (job.status === "failed") throw new Error(job.error || "Фоновая задача завершилась ошибкой");
    if (job.status === "cancelled") throw new Error("Фоновая задача отменена");
  }
}

function latestJobMessage(job: JobResponse) {
  const latest = job.logs[job.logs.length - 1];
  return latest?.message || job.error || "Ожидание статуса";
}

function translateJobStatus(status: JobResponse["status"]) {
  const labels: Record<JobResponse["status"], string> = {
    pending: "в очереди",
    running: "в работе",
    completed: "готово",
    failed: "ошибка",
    cancelled: "отменено"
  };
  return labels[status];
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
