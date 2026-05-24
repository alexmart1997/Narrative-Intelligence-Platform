"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
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

type SceneNode = GraphNode & {
  position: THREE.Vector3;
  size: number;
  color: string;
  weight: number;
  confidence: number;
};

type NodeMesh = THREE.Mesh & {
  userData: {
    graphNode: SceneNode;
    baseSize: number;
  };
};

type GraphMode = "article" | "event" | "narrative" | "divergence";

type VisualFilters = {
  showEntities: boolean;
  showArticles: boolean;
  showSources: boolean;
  showNarratives: boolean;
  showWeakEdges: boolean;
  confidenceThreshold: number;
  labelDensity: number;
};

type CameraMode = "free" | "top";

type SceneApi = {
  dispose: () => void;
  resetView: () => void;
  topDown: () => void;
};

const defaultFilters: VisualFilters = {
  showEntities: true,
  showArticles: true,
  showSources: true,
  showNarratives: true,
  showWeakEdges: false,
  confidenceThreshold: 0,
  labelDensity: 0.52
};

const entityNodeTypes = new Set(["person", "organization", "country", "location", "concept"]);
const routeEdgeTypes = new Set(["same_event_as", "similar_to", "shares_narrative", "entity_in_article"]);
const entityOrNarrativeTypes = new Set(["person", "organization", "country", "location", "concept", "narrative"]);

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
  shares_narrative: "общий нарратив",
  entity_in_article: "содержит объект"
};

const nodePalette: Record<string, string> = {
  article: "#38bdf8",
  source: "#a7f3d0",
  person: "#fbbf24",
  organization: "#c084fc",
  country: "#22d3ee",
  location: "#2dd4bf",
  concept: "#e0f2fe",
  narrative: "#fb7185"
};

const edgePalette: Record<string, string> = {
  same_event_as: "#86efac",
  similar_to: "#38bdf8",
  entity_in_article: "#fbbf24",
  shares_narrative: "#fb7185",
  sympathizes_with: "#86efac",
  criticizes: "#fb7185",
  supports_narrative: "#fda4af",
  published_by: "#a7f3d0",
  mentions: "#7dd3fc",
  relates_to: "#cbd5e1"
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
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const articleNode = graph?.nodes.find((node) => node.id === `article_${activeArticleId}`);
    return graphNodeLabel(articleNode) ?? `Статья ${activeArticleId}`;
  }, [activeArticleId, graph]);

  const relatedCount = useMemo(() => {
    if (!graph) return 0;
    return graph.nodes.filter((node) => node.type === "article" && node.id !== `article_${activeArticleId}`).length;
  }, [activeArticleId, graph]);

  const narrativeSignals = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((node) => node.type === "narrative")
      .map((node) => ({
        id: node.id,
        title: graphNodeLabel(node),
        confidence: nodeConfidence(node),
        evidenceCount: Number(node.data.narrative_evidence_count ?? node.data.evidence_count ?? 0),
      }))
      .sort((left, right) => {
        const evidenceDelta = right.evidenceCount - left.evidenceCount;
        return evidenceDelta !== 0 ? evidenceDelta : right.confidence - left.confidence;
      })
      .slice(0, 5);
  }, [graph]);

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
      onNodeSelect: (node) => {
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
          setFocusEntity({ id: entityId, name: node.label });
        }
      }
    });

    return () => {
      sceneApiRef.current?.dispose();
      sceneApiRef.current = null;
    };
  }, [activeArticleId, autoOrbit, cameraMode, filters, focusMode, graph, graphMode, router, selectedNode?.id]);

  async function loadGraph(articleId: number, focusEntityId: number | null = focusEntity?.id ?? null) {
    setLoading(true);
    setError(null);
    try {
      const data = await getArticleGraph(articleId, {
        includeRelated: true,
        limitRelated: 30,
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

  function updateFilter<K extends keyof VisualFilters>(key: K, value: VisualFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
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
            <button onClick={() => setFocusEntity(null)} disabled={loading || processing}>
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
          <div className={styles.modeBar}>
            {(["article", "event", "narrative", "divergence"] as GraphMode[]).map((mode) => (
              <button
                key={mode}
                className={graphMode === mode ? styles.activeMode : ""}
                onClick={() => setGraphMode(mode)}
              >
                {translateGraphMode(mode)}
              </button>
            ))}
          </div>
          <div className={styles.filterPanel}>
            <strong>Фильтры</strong>
            <label>
              <input type="checkbox" checked={filters.showEntities} onChange={(event) => updateFilter("showEntities", event.target.checked)} />
              сущности
            </label>
            <label>
              <input type="checkbox" checked={filters.showArticles} onChange={(event) => updateFilter("showArticles", event.target.checked)} />
              статьи
            </label>
            <label>
              <input type="checkbox" checked={filters.showSources} onChange={(event) => updateFilter("showSources", event.target.checked)} />
              источники
            </label>
            <label>
              <input type="checkbox" checked={filters.showNarratives} onChange={(event) => updateFilter("showNarratives", event.target.checked)} />
              нарративы
            </label>
            <label>
              <input type="checkbox" checked={filters.showWeakEdges} onChange={(event) => updateFilter("showWeakEdges", event.target.checked)} />
              слабые связи
            </label>
            <label>
              уверенность
              <input
                type="range"
                min="0"
                max="0.95"
                step="0.05"
                value={filters.confidenceThreshold}
                onChange={(event) => updateFilter("confidenceThreshold", Number(event.target.value))}
              />
            </label>
            <label>
              подписи
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={filters.labelDensity}
                onChange={(event) => updateFilter("labelDensity", Number(event.target.value))}
              />
            </label>
          </div>
          <div className={styles.legend}>
            {nodeTypes.map((item) => (
              <span key={item.type}>
                <i className={`${styles.legendDot} ${styles[item.type]}`} />
                {item.label}
              </span>
            ))}
          </div>
          <div className={styles.sceneMeta}>
            <strong>Карта связей</strong>
            <span>Размер = важность / плотность / уверенность</span>
            <span>Прозрачность = confidence, толщина дуги = сила связи</span>
            <span>Клик по статье = открыть ее граф · клик по сущности = переезд к новостям с ней</span>
            <span>Hover подсвечивает соседей · particles показывают направление</span>
          </div>
          {focusEntity ? (
            <div className={styles.focusBanner}>
              <strong>Фокус на объекте</strong>
              <span>{focusEntity.name}</span>
              <button onClick={() => setFocusEntity(null)}>Показать исходную статью</button>
            </div>
          ) : null}
          <div className={styles.routeGuide}>
            <strong>Маршруты к связанным новостям</strong>
            <span className={styles.routeLine} />
            <p>Светящиеся дуги ведут к похожим статьям, общим событиям и новостям с выбранным объектом.</p>
          </div>
          {graph && relatedCount === 0 ? (
            <div className={styles.insight}>
              Связанные статьи не показаны: похожесть ниже порога 0.55 или для соседних статей еще нет анализа.
            </div>
          ) : null}
          {loading ? <div className={styles.state}>Загружаю 3D-граф...</div> : null}
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
          <div ref={containerRef} className={styles.canvas} aria-label="3D граф статьи" />
        </section>

        <aside className={styles.detailPanel}>
          <h2>Детали</h2>
          <NarrativeSignals signals={narrativeSignals} />
          <div className={styles.readingGuide}>
            <strong>Как читать сцену</strong>
            <p>Шарик = объект анализа: статья, источник, участник или нарратив.</p>
            <p>Размер статьи = плотность: сколько вокруг нее события, evidence, сущностей и связей.</p>
            <p>Дуга = тип связи. Яркие дуги показывают то же событие или общий нарратив.</p>
          </div>
          {selectedNode ? <NodeDetails node={selectedNode} currentArticleId={activeArticleId} /> : null}
          {selectedEdge ? <EdgeDetails edge={selectedEdge} /> : null}
          {!selectedNode && !selectedEdge ? (
            <p className={styles.hint}>
              Кликни по статье, чтобы перейти в ее граф. Клик по персоне, организации,
              стране или концепту перестроит сцену вокруг новостей с этим объектом.
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function createThreeGraphScene({
  activeArticleId,
  autoOrbit,
  cameraMode,
  container,
  filters,
  focusMode,
  graph,
  mode,
  onEdgeSelect,
  onNodeSelect,
  selectedNodeId
}: {
  activeArticleId: number;
  autoOrbit: boolean;
  cameraMode: CameraMode;
  container: HTMLDivElement;
  filters: VisualFilters;
  focusMode: boolean;
  graph: ArticleGraphResponse;
  mode: GraphMode;
  onEdgeSelect: (edge: GraphEdge) => void;
  onNodeSelect: (node: GraphNode) => void;
  selectedNodeId: string | null;
}) {
  const visibleGraph = applyGraphFilters(graph, filters, focusMode ? selectedNodeId : null);
  const sceneNodes = centerSceneNodes(buildSceneNodes(visibleGraph, activeArticleId, mode));
  const nodeById = new Map(sceneNodes.map((node) => [node.id, node]));
  const neighborMap = buildNeighborMap(visibleGraph.edges);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2("#030405", 0.002);

  const width = Math.max(container.clientWidth, 640);
  const height = Math.max(container.clientHeight, 480);
  const camera = new THREE.PerspectiveCamera(46, width / height, 1, 5000);
  camera.position.set(0, 220, 680);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  container.replaceChildren(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.46, 0.62, 0.15);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const labelLayer = document.createElement("div");
  labelLayer.className = styles.labelLayer;
  container.appendChild(labelLayer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.75;
  controls.panSpeed = 0.5;
  controls.minDistance = 160;
  controls.maxDistance = 1200;
  controls.autoRotate = autoOrbit;
  controls.autoRotateSpeed = 0.8;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight("#7dd3fc", 0.56));
  const keyLight = new THREE.PointLight("#38bdf8", 2.55, 1200);
  keyLight.position.set(-220, 260, 300);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight("#fb923c", 1.7, 900);
  warmLight.position.set(260, -180, 260);
  scene.add(warmLight);

  const nodeMeshes: NodeMesh[] = [];
  const labelItems: Array<{ element: HTMLDivElement; node: SceneNode }> = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const edgeObjects: Array<{ edge: GraphEdge; object: THREE.Object3D }> = [];
  const animatedParticles: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; speed: number; offset: number }> = [];
  let hoveredNodeId: string | null = null;
  let flyTarget: { camera: THREE.Vector3; target: THREE.Vector3; startedAt: number; duration: number } | null = null;
  const clock = new THREE.Clock();

  addStarField(scene);
  addDepthRings(scene);

  for (const edge of visibleGraph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const object = createEdgeObject(source, target, edge);
    scene.add(object);
    edgeObjects.push({ edge, object });
    if (animatedParticles.length < 140) {
      const items = createFlowParticles(source, target, edge);
      for (const item of items) {
        scene.add(item.mesh);
        animatedParticles.push(item);
      }
    }
  }

  for (const node of sceneNodes) {
    const selected = node.id === selectedNodeId;
    const mesh = createNodeMesh(node, node.id === `article_${activeArticleId}` || Boolean(node.data.is_focus), selected) as unknown as NodeMesh;
    mesh.userData.graphNode = node;
    mesh.userData.baseSize = node.size;
    scene.add(mesh);
    nodeMeshes.push(mesh);

    const label = createHtmlLabel(node);
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      onNodeSelect(node);
    });
    labelLayer.appendChild(label);
    labelItems.push({ element: label, node });
  }

  function render() {
    const delta = clock.getDelta();
    if (flyTarget) {
      const progress = Math.min(1, (performance.now() - flyTarget.startedAt) / flyTarget.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerp(flyTarget.camera, eased);
      controls.target.lerp(flyTarget.target, eased);
      if (progress >= 1) flyTarget = null;
    }
    updateFlowParticles(animatedParticles, delta);
    controls.update();
    updateHtmlLabels(labelItems, camera, renderer, filters.labelDensity, hoveredNodeId, selectedNodeId);
    composer.render();
    animationId = requestAnimationFrame(render);
  }

  function resize() {
    const nextWidth = Math.max(container.clientWidth, 640);
    const nextHeight = Math.max(container.clientHeight, 480);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
    composer.setSize(nextWidth, nextHeight);
  }

  function click(event: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const nodeHit = raycaster.intersectObjects(nodeMeshes, false)[0];
    if (nodeHit) {
      onNodeSelect((nodeHit.object as NodeMesh).userData.graphNode);
      flyToNode((nodeHit.object as NodeMesh).userData.graphNode);
      return;
    }

    raycaster.params.Line = { threshold: 9 };
    const lineHit = raycaster.intersectObjects(edgeObjects.map((item) => item.object), true)[0];
    if (lineHit) {
      const edgeId = lineHit.object.userData.edgeId;
      const edgeItem = edgeObjects.find((item) => item.edge.id === edgeId || item.object === lineHit.object);
      if (edgeItem) onEdgeSelect(edgeItem.edge);
    }
  }

  function move(event: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const nodeHit = raycaster.intersectObjects(nodeMeshes, false)[0];
    const nextHoveredId = nodeHit ? (nodeHit.object as NodeMesh).userData.graphNode.id : null;
    if (nextHoveredId !== hoveredNodeId) {
      hoveredNodeId = nextHoveredId;
      applyHoverState(nodeMeshes, edgeObjects, neighborMap, hoveredNodeId, selectedNodeId);
    }
  }

  let animationId = requestAnimationFrame(render);
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("click", click);
  renderer.domElement.addEventListener("mousemove", move);

  if (cameraMode === "top") {
    topDown();
  }

  function resetView() {
    camera.position.set(0, 220, 680);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function topDown() {
    camera.position.set(0, 820, 8);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function flyToNode(node: SceneNode) {
    const direction = camera.position.clone().sub(controls.target).normalize();
    flyTarget = {
      camera: node.position.clone().add(direction.multiplyScalar(280)),
      target: node.position.clone(),
      startedAt: performance.now(),
      duration: 850,
    };
  }

  return {
    dispose() {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("click", click);
      renderer.domElement.removeEventListener("mousemove", move);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      composer.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
    resetView,
    topDown
  };
}

function applyGraphFilters(graph: ArticleGraphResponse, filters: VisualFilters, focusNodeId: string | null): ArticleGraphResponse {
  const allowedNodeIds = new Set<string>();
  const neighbors = focusNodeId ? buildNeighborMap(graph.edges).get(focusNodeId) ?? new Set<string>() : null;

  for (const node of graph.nodes) {
    if (!filters.showArticles && node.type === "article") continue;
    if (!filters.showSources && node.type === "source") continue;
    if (!filters.showNarratives && node.type === "narrative") continue;
    if (!filters.showEntities && entityNodeTypes.has(node.type)) continue;
    if (focusNodeId && node.id !== focusNodeId && !neighbors?.has(node.id)) continue;
    allowedNodeIds.add(node.id);
  }

  const edges = graph.edges.filter((edge) => {
    if (!allowedNodeIds.has(edge.source) || !allowedNodeIds.has(edge.target)) return false;
    const strength = edgeStrength(edge);
    if (!filters.showWeakEdges && strength < 0.5) return false;
    return strength >= filters.confidenceThreshold;
  });

  return {
    nodes: graph.nodes.filter((node) => allowedNodeIds.has(node.id)),
    edges,
  };
}

function buildNeighborMap(edges: GraphEdge[]) {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, new Set());
    if (!map.has(edge.target)) map.set(edge.target, new Set());
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

function buildSceneNodes(graph: ArticleGraphResponse, activeArticleId: number, mode: GraphMode): SceneNode[] {
  const activeId = `article_${activeArticleId}`;
  const focusEntity = graph.nodes.find((node) => Boolean(node.data.is_focus));
  const relatedArticles = graph.nodes.filter((node) => node.type === "article" && node.id !== activeId);
  const entities = graph.nodes.filter((node) => !["article", "source", "narrative"].includes(node.type) && node.id !== focusEntity?.id);
  const sources = graph.nodes.filter((node) => node.type === "source");
  const narratives = graph.nodes.filter((node) => node.type === "narrative");
  const active = graph.nodes.find((node) => node.id === activeId);
  const result: SceneNode[] = [];

  if (mode === "event") {
    const articles = graph.nodes.filter((node) => node.type === "article");
    articles.forEach((node, index) => {
      const angle = (index / Math.max(articles.length, 1)) * Math.PI * 2;
      const radius = node.id === activeId ? 44 : 215 + (index % 2) * 44;
      result.push(toSceneNode(
        node,
        new THREE.Vector3(Math.cos(angle) * radius + sourceOffsetForArticle(node, index), Math.sin(index) * 44, Math.sin(angle) * radius),
        node.id === activeId,
      ));
    });
    sources.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(-285, (index - sources.length / 2) * 95, -125), false)));
    entities.slice(0, 12).forEach((node, index) => result.push(radialNode(node, index, entities.length, 345, 82, false)));
    narratives.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(285, (index - narratives.length / 2) * 92, -140), false)));
    return result;
  }

  if (mode === "narrative") {
    const mainNarrative = narratives[0];
    if (mainNarrative) result.push(toSceneNode(mainNarrative, new THREE.Vector3(0, 0, 0), true));
    graph.nodes
      .filter((node) => node.type === "article")
      .forEach((node, index, articles) => result.push(radialNode(node, index, articles.length, 215, 68, node.id === activeId)));
    sources.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(-270, (index - sources.length / 2) * 86, -100), false)));
    entities.slice(0, 10).forEach((node, index) => result.push(radialNode(node, index, entities.length, 335, 90, false)));
    narratives.slice(1).forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(260, (index - narratives.length / 2) * 90, -130), false)));
    return result;
  }

  if (mode === "divergence") {
    if (active) result.push(toSceneNode(active, new THREE.Vector3(0, 0, 0), true));
    sources.forEach((node, index) => {
      const angle = (index / Math.max(sources.length, 1)) * Math.PI * 2;
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * 250, Math.sin(index) * 56, Math.sin(angle) * 250), false));
    });
    narratives.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(300, (index - narratives.length / 2) * 88, -90), false)));
    entities.forEach((node, index) => result.push(radialNode(node, index, entities.length, 165 + (index % 3) * 34, 76, false)));
    relatedArticles.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(-280, (index - relatedArticles.length / 2) * 92, -110), false)));
    return result;
  }

  if (focusEntity) {
    result.push(toSceneNode(focusEntity, new THREE.Vector3(0, 0, 0), true));
    if (active) result.push(toSceneNode(active, new THREE.Vector3(-105, 18, 82), false));

    relatedArticles.forEach((node, index) => {
      const angle = (index / Math.max(relatedArticles.length, 1)) * Math.PI * 2;
      const radius = 205 + (index % 3) * 28;
      const y = Math.sin(index * 1.15) * 62;
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), false));
    });
  } else if (active) {
    result.push(toSceneNode(active, new THREE.Vector3(0, 0, 0), true));
  }

  sources.forEach((node, index) => {
    const spread = (index - (sources.length - 1) / 2) * 72;
    result.push(toSceneNode(node, new THREE.Vector3(-190, 58 + spread, -78 - index * 20), false));
  });

  narratives.forEach((node, index) => {
    const spread = (index - (narratives.length - 1) / 2) * 82;
    result.push(toSceneNode(node, new THREE.Vector3(205, -52 + spread, -92 + index * 28), false));
  });

  entities.forEach((node, index) => {
    const angle = (index / Math.max(entities.length, 1)) * Math.PI * 2;
    const radius = 150 + (index % 4) * 30;
    const y = Math.sin(index * 1.73) * 68;
    result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), false));
  });

  if (!focusEntity) {
    relatedArticles.forEach((node, index) => {
      const angle = Math.PI * 0.1 + (index / Math.max(relatedArticles.length - 1, 1)) * Math.PI * 0.82;
      const radius = 235 + (index % 2) * 34;
      const y = -42 + Math.sin(index * 0.9) * 78;
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, -126 + Math.sin(angle) * radius), false));
    });
  }

  return result;
}

function centerSceneNodes(nodes: SceneNode[]) {
  if (nodes.length === 0) return nodes;
  const bounds = new THREE.Box3().setFromPoints(nodes.map((node) => node.position));
  const center = bounds.getCenter(new THREE.Vector3());
  // Центрируем не только активную статью, а всю карту: иначе плотные связки могут стартовать ниже экрана.
  for (const node of nodes) {
    node.position.sub(center);
    node.position.y += 28;
  }
  return nodes;
}

function radialNode(node: GraphNode, index: number, count: number, radius: number, yScale: number, focused: boolean) {
  const angle = (index / Math.max(count, 1)) * Math.PI * 2;
  return toSceneNode(
    node,
    new THREE.Vector3(Math.cos(angle) * radius, Math.sin(index * 1.3) * yScale, Math.sin(angle) * radius),
    focused,
  );
}

function sourceOffsetForArticle(node: GraphNode, index: number) {
  const sourceName = String(node.data.source_name ?? "");
  if (!sourceName) return 0;
  return ((sourceName.charCodeAt(0) + index * 17) % 5 - 2) * 32;
}

function toSceneNode(node: GraphNode, position: THREE.Vector3, focused: boolean): SceneNode {
  const density = Math.min(5, Math.max(1, Number(node.data.density_score ?? 1)));
  const confidence = nodeConfidence(node);
  const importance = Number(node.data.importance_score ?? node.data.confidence ?? confidence);
  const centrality = density + Math.min(4, Object.keys(node.data).length / 3);
  const weight = Math.max(0.35, Math.min(1.8, importance + centrality * 0.13));
  const baseSize = node.type === "article" ? 13 + density * 2.2 + weight * 2.5 : node.type === "narrative" ? 19 + weight * 4 : 14 + weight * 3.2;
  return {
    ...node,
    color: focused ? "#f97316" : nodePalette[node.type] ?? "#67e8f9",
    confidence,
    position,
    size: focused ? Math.max(34, baseSize * 1.12) : baseSize,
    weight,
  };
}

function createNodeMesh(node: SceneNode, focused: boolean, selected: boolean) {
  const geometry = new THREE.SphereGeometry(node.size, 32, 24);
  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: focused || selected ? 1.45 : node.type === "article" ? 0.82 : 0.55,
    metalness: 0.15,
    roughness: 0.26,
    transparent: true,
    opacity: Math.max(0.46, Math.min(0.96, node.confidence)),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(node.position);

  const glowGeometry = new THREE.SphereGeometry(node.size * (focused || selected ? 1.8 : 1.45), 32, 24);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: node.color,
    transparent: true,
    opacity: focused || selected ? 0.12 : 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  mesh.add(glow);

  if (node.type === "article" || selected) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(node.size * (selected ? 1.95 : 1.65), selected ? 1.7 : 1.15, 10, 88),
      new THREE.MeshBasicMaterial({
        color: selected ? "#fbbf24" : "#38bdf8",
        transparent: true,
        opacity: selected ? 0.72 : 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2.35;
    mesh.add(ring);
  }
  return mesh;
}

function createEdgeObject(source: SceneNode, target: SceneNode, edge: GraphEdge): THREE.Object3D {
  const curve = edgeCurve(source, target);
  const color = edgePalette[edge.label] ?? "#7dd3fc";
  const strength = edgeStrength(edge);
  const opacity = Math.max(0.14, Math.min(0.82, strength * 0.88));
  if (routeEdgeTypes.has(edge.label)) {
    const group = new THREE.Group();
    group.userData.edgeId = edge.id;
    const geometry = new THREE.TubeGeometry(curve, 52, (edge.label === "same_event_as" ? 2.6 : 1.8) + strength * 2.2, 10, false);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: Math.max(0.34, opacity),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(geometry, material);
    tube.userData.edgeId = edge.id;
    group.add(tube);

    // Световые точки делают маршрут к похожей статье читаемым на общем масштабе.
    for (let index = 1; index <= 5; index += 1) {
      const point = curve.getPoint(index / 6);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(edge.label === "same_event_as" ? 5.2 : 4.4, 16, 12),
        new THREE.MeshBasicMaterial({
          color: index % 2 === 0 ? "#f97316" : color,
          transparent: true,
          opacity: Math.max(0.3, opacity * 0.82),
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      marker.position.copy(point);
      marker.userData.edgeId = edge.id;
      group.add(marker);
    }
    return group;
  }

  const points = curve.getPoints(36);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: Math.max(0.14, opacity * 0.56),
    blending: THREE.AdditiveBlending
  });
  return new THREE.Line(geometry, material);
}

function edgeCurve(source: SceneNode, target: SceneNode) {
  const midpoint = source.position.clone().add(target.position).multiplyScalar(0.5);
  midpoint.y += 36 + source.position.distanceTo(target.position) * 0.1;
  return new THREE.QuadraticBezierCurve3(source.position, midpoint, target.position);
}

function createFlowParticles(source: SceneNode, target: SceneNode, edge: GraphEdge) {
  const strength = edgeStrength(edge);
  if (strength < 0.2) return [];
  const curve = edgeCurve(source, target);
  const color = edgePalette[edge.label] ?? "#7dd3fc";
  const particleCount = routeEdgeTypes.has(edge.label) ? 3 : 1;
  const items: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; speed: number; offset: number }> = [];
  for (let index = 0; index < particleCount; index += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.3 + strength * 2.5, 12, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.userData.edgeId = edge.id;
    items.push({
      mesh,
      curve,
      speed: 0.12 + strength * 0.32,
      offset: index / particleCount,
    });
  }
  return items;
}

function updateFlowParticles(
  particles: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; speed: number; offset: number }>,
  delta: number,
) {
  for (const item of particles) {
    item.offset = (item.offset + delta * item.speed) % 1;
    item.mesh.position.copy(item.curve.getPoint(item.offset));
  }
}

function applyHoverState(
  nodeMeshes: NodeMesh[],
  edgeObjects: Array<{ edge: GraphEdge; object: THREE.Object3D }>,
  neighborMap: Map<string, Set<string>>,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  const highlighted = new Set<string>();
  if (hoveredNodeId) {
    highlighted.add(hoveredNodeId);
    (neighborMap.get(hoveredNodeId) ?? new Set<string>()).forEach((id) => highlighted.add(id));
  }
  if (selectedNodeId) {
    highlighted.add(selectedNodeId);
    (neighborMap.get(selectedNodeId) ?? new Set<string>()).forEach((id) => highlighted.add(id));
  }

  for (const mesh of nodeMeshes) {
    const node = mesh.userData.graphNode;
    const active = highlighted.size === 0 || highlighted.has(node.id);
    mesh.scale.setScalar(active ? (node.id === hoveredNodeId ? 1.18 : 1) : 0.72);
    const material = mesh.material;
    if (!Array.isArray(material)) {
      material.opacity = active ? Math.max(0.44, Math.min(0.96, node.confidence)) : 0.16;
      material.needsUpdate = true;
    }
  }

  for (const item of edgeObjects) {
    const active = highlighted.size === 0 || highlighted.has(item.edge.source) || highlighted.has(item.edge.target);
    item.object.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const material = object.material;
        if (!Array.isArray(material)) {
          material.opacity = active ? Math.max(0.22, Math.min(0.72, edgeStrength(item.edge) * 0.82)) : 0.06;
          material.needsUpdate = true;
        }
      }
    });
  }
}

function nodeConfidence(node: GraphNode) {
  const value = Number(
    node.data.confidence
    ?? node.data.importance_score
    ?? node.data.same_event_probability
    ?? node.data.similarity
    ?? node.data.score
    ?? 0.82
  );
  return Number.isFinite(value) ? Math.max(0.18, Math.min(1, value)) : 0.82;
}

function edgeStrength(edge: GraphEdge) {
  const value = Number(
    edge.data.confidence
    ?? edge.data.same_event_probability
    ?? edge.data.similarity
    ?? edge.data.score
    ?? edge.data.importance_score
    ?? (routeEdgeTypes.has(edge.label) ? 0.78 : 0.48)
  );
  return Number.isFinite(value) ? Math.max(0.05, Math.min(1, value)) : 0.48;
}

function addStarField(scene: THREE.Scene) {
  const count = 760;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 1600;
    positions[index * 3 + 1] = (Math.random() - 0.5) * 900;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 1600;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#38bdf8",
    opacity: 0.23,
    size: 1.35,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  scene.add(new THREE.Points(geometry, material));
}

function addDepthRings(scene: THREE.Scene) {
  for (const radius of [190, 330, 470]) {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.52);
    const points = curve.getPoints(160).map((point) => new THREE.Vector3(point.x, -140, point.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: "#155e75",
      opacity: 0.18,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.LineLoop(geometry, material));
  }
}

function createHtmlLabel(node: SceneNode) {
  const element = document.createElement("div");
  element.className = `${styles.nodeLabel} ${styles[`label_${node.type}`] ?? ""}`;
  element.innerHTML = `
    <span>${translateNodeType(node.type)}</span>
    <strong>${escapeHtml(shortLabel(graphNodeLabel(node)))}</strong>
  `;
  return element;
}

function updateHtmlLabels(
  labels: Array<{ element: HTMLDivElement; node: SceneNode }>,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  labelDensity: number,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const candidates = labels
    .map((item) => {
      const vector = item.node.position.clone();
      vector.y += item.node.size + 22;
      vector.project(camera);
      const x = (vector.x * 0.5 + 0.5) * width;
      const y = (-vector.y * 0.5 + 0.5) * height;
      const distance = camera.position.distanceTo(item.node.position);
      const zoomFactor = distance < 420 ? 0.36 : distance < 720 ? 0.2 : 0.06;
      const required = item.node.id === hoveredNodeId
        || item.node.id === selectedNodeId
        || Boolean(item.node.data.is_focus);
      return {
        item,
        distance,
        priority: labelPriority(item.node, distance, hoveredNodeId, selectedNodeId) + zoomFactor * 120,
        required,
        visible: vector.z < 1 && x > -120 && x < width + 120 && y > -80 && y < height + 120,
        x,
        y,
      };
    })
    .sort((left, right) => right.priority - left.priority);

  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const maxLabels = Math.round(10 + labelDensity * 38 + Math.max(0, 820 - camera.position.length()) / 36);
  const minPriority = 250 + (1 - labelDensity) * 245;
  let shown = 0;

  for (const candidate of candidates) {
    const { item, x, y, visible, required, priority, distance } = candidate;
    const labelWidth = item.element.offsetWidth || 160;
    const labelHeight = item.element.offsetHeight || 48;
    const box = {
      left: x - labelWidth / 2 - 8,
      right: x + labelWidth / 2 + 8,
      top: y - labelHeight - 10,
      bottom: y + 8,
    };
    const overlaps = occupied.some((placed) => (
      box.left < placed.right
      && box.right > placed.left
      && box.top < placed.bottom
      && box.bottom > placed.top
    ));
    const canShow = visible
      && (required || priority >= minPriority)
      && (required || shown < maxLabels)
      && (!overlaps || required);

    item.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    item.element.style.opacity = canShow ? "1" : "0";
    item.element.style.pointerEvents = canShow ? "auto" : "none";
    item.element.style.zIndex = String(Math.max(1, Math.round(3000 - distance)));
    item.element.dataset.visible = canShow ? "true" : "false";
    if (canShow) {
      shown += 1;
      occupied.push(box);
    }
  }
}

function labelPriority(
  node: SceneNode,
  distance: number,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  let priority = node.weight * 120 + node.confidence * 90;
  if (node.id === hoveredNodeId) priority += 1200;
  if (node.id === selectedNodeId) priority += 1100;
  if (Boolean(node.data.is_focus)) priority += 950;
  if (node.type === "narrative") priority += 680;
  if (node.type === "article" && node.id.startsWith("article_")) priority += 580;
  if (node.type === "source") priority += 340;
  if (entityNodeTypes.has(node.type) && node.weight > 1.15) priority += 210;
  priority += Math.max(0, 760 - distance) * 0.32;
  return priority;
}

function shortLabel(value: string) {
  return value.length > 58 ? `${value.slice(0, 55)}...` : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function NarrativeSignals({
  signals
}: {
  signals: Array<{ id: string; title: string; confidence: number; evidenceCount: number }>;
}) {
  return (
    <section className={styles.narrativeSignals}>
      <div>
        <span>Нарративный слой</span>
        <h3>Общие линии графа</h3>
      </div>
      {signals.length > 0 ? (
        <div className={styles.narrativeSignalList}>
          {signals.map((signal) => (
            <article key={signal.id} className={styles.narrativeSignal}>
              <strong>{signal.title}</strong>
              <small>
                {formatNumber(signal.confidence)}
                {signal.evidenceCount ? ` · ${signal.evidenceCount} доказательств` : ""}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p>
          Для этой сцены пока нет общего нарратива. Запусти анализ и discovery, чтобы система
          связала статьи в смысловые линии.
        </p>
      )}
    </section>
  );
}

function NodeDetails({ currentArticleId, node }: { currentArticleId: number; node: GraphNode }) {
  const articleId = Number(node.data.article_id);
  return (
    <div className={styles.details}>
      <span className={`${styles.badge} ${styles[node.type]}`}>{translateNodeType(node.type)}</span>
      <h3>{graphNodeLabel(node)}</h3>
      {node.type === "article" && Number.isFinite(articleId) && articleId !== currentArticleId ? (
        <p className={styles.hint}>Клик по этой статье перестроит 3D-сцену вокруг нее.</p>
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

function translateNodeType(type: string) {
  return nodeTypes.find((item) => item.type === type)?.label ?? type;
}

function graphNodeLabel(node: GraphNode | SceneNode | undefined) {
  if (!node) return "";
  const displayLabel = node.data.display_label;
  return typeof displayLabel === "string" && displayLabel.trim() ? displayLabel : node.label;
}

function translateEdge(label: string) {
  return edgeLabels[label] ?? label;
}

function translateGraphMode(mode: GraphMode) {
  const labels: Record<GraphMode, string> = {
    article: "Статья",
    event: "Событие",
    narrative: "Нарратив",
    divergence: "Расхождения",
  };
  return labels[mode];
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
    density_score: "Плотность",
    event_article_count: "Статей в событии",
    narrative_evidence_count: "Доказательств нарратива",
    entity_count: "Сущностей",
    relation_count: "Отношений",
    synthetic: "Создано из вывода LLM",
    polarity: "Полярность",
    type: "Тип"
  };
  return labels[key] ?? key;
}

function formatNumber(value: number) {
  if (!Number.isInteger(value) && value > 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return String(value);
}
