"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
};

type NodeMesh = THREE.Mesh & {
  userData: {
    graphNode: SceneNode;
  };
};

const entityNodeTypes = new Set(["person", "organization", "country", "location", "concept"]);
const routeEdgeTypes = new Set(["same_event_as", "similar_to", "shares_narrative", "entity_in_article"]);

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
  const sceneApiRef = useRef<{ dispose: () => void; rerun: () => void } | null>(null);
  const [graph, setGraph] = useState<ArticleGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [focusEntity, setFocusEntity] = useState<{ id: number; name: string } | null>(null);
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
  }, [activeArticleId, graph, router]);

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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Назад к статьям
          </Link>
          <p className={styles.eyebrow}>3D intelligence graph</p>
          <h1>{title}</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.stats}>
            {graph ? `${graph.nodes.length} узлов · ${graph.edges.length} связей · ${relatedCount} связанных статей` : "3D граф"}
          </span>
          <button onClick={() => sceneApiRef.current?.rerun()} disabled={!graph || loading}>
            Сфокусировать
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
          <div className={styles.legend}>
            {nodeTypes.map((item) => (
              <span key={item.type}>
                <i className={`${styles.legendDot} ${styles[item.type]}`} />
                {item.label}
              </span>
            ))}
          </div>
          <div className={styles.sceneMeta}>
            <strong>Density map</strong>
            <span>Размер точки = сила события / нарратива</span>
            <span>Клик по статье = открыть ее граф · клик по сущности = переезд к новостям с ней</span>
            <span>Drag = orbit · Wheel = zoom</span>
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
  container,
  graph,
  onEdgeSelect,
  onNodeSelect
}: {
  activeArticleId: number;
  container: HTMLDivElement;
  graph: ArticleGraphResponse;
  onEdgeSelect: (edge: GraphEdge) => void;
  onNodeSelect: (node: GraphNode) => void;
}) {
  const sceneNodes = buildSceneNodes(graph, activeArticleId);
  const nodeById = new Map(sceneNodes.map((node) => [node.id, node]));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2("#030405", 0.0019);

  const width = Math.max(container.clientWidth, 640);
  const height = Math.max(container.clientHeight, 480);
  const camera = new THREE.PerspectiveCamera(46, width / height, 1, 5000);
  camera.position.set(0, 220, 680);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

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
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight("#7dd3fc", 0.7));
  const keyLight = new THREE.PointLight("#38bdf8", 3.4, 1200);
  keyLight.position.set(-220, 260, 300);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight("#fb923c", 2.4, 900);
  warmLight.position.set(260, -180, 260);
  scene.add(warmLight);

  const nodeMeshes: NodeMesh[] = [];
  const labelItems: Array<{ element: HTMLDivElement; node: SceneNode }> = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const edgeObjects: Array<{ edge: GraphEdge; object: THREE.Object3D }> = [];

  addStarField(scene);
  addDepthRings(scene);

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const object = createEdgeObject(source, target, edge);
    scene.add(object);
    edgeObjects.push({ edge, object });
  }

  for (const node of sceneNodes) {
    const mesh = createNodeMesh(node, node.id === `article_${activeArticleId}`) as unknown as NodeMesh;
    mesh.userData.graphNode = node;
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
    controls.update();
    updateHtmlLabels(labelItems, camera, renderer);
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(render);
  }

  function resize() {
    const nextWidth = Math.max(container.clientWidth, 640);
    const nextHeight = Math.max(container.clientHeight, 480);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  }

  function click(event: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const nodeHit = raycaster.intersectObjects(nodeMeshes, false)[0];
    if (nodeHit) {
      onNodeSelect((nodeHit.object as NodeMesh).userData.graphNode);
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

  let animationId = requestAnimationFrame(render);
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("click", click);

  function focus() {
    camera.position.set(0, 220, 680);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  return {
    dispose() {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("click", click);
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
      renderer.dispose();
      container.replaceChildren();
    },
    rerun: focus
  };
}

function buildSceneNodes(graph: ArticleGraphResponse, activeArticleId: number): SceneNode[] {
  const activeId = `article_${activeArticleId}`;
  const focusEntity = graph.nodes.find((node) => Boolean(node.data.is_focus));
  const relatedArticles = graph.nodes.filter((node) => node.type === "article" && node.id !== activeId);
  const entities = graph.nodes.filter((node) => !["article", "source", "narrative"].includes(node.type) && node.id !== focusEntity?.id);
  const sources = graph.nodes.filter((node) => node.type === "source");
  const narratives = graph.nodes.filter((node) => node.type === "narrative");
  const active = graph.nodes.find((node) => node.id === activeId);
  const result: SceneNode[] = [];

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

function toSceneNode(node: GraphNode, position: THREE.Vector3, focused: boolean): SceneNode {
  const density = Math.min(5, Math.max(1, Number(node.data.density_score ?? 1)));
  const baseSize = node.type === "article" ? 15 + density * 2.3 : node.type === "narrative" ? 23 : 17;
  return {
    ...node,
    color: focused ? "#f97316" : nodePalette[node.type] ?? "#67e8f9",
    position,
    size: focused ? Math.max(32, baseSize * 1.08) : baseSize
  };
}

function createNodeMesh(node: SceneNode, focused: boolean) {
  const geometry = new THREE.SphereGeometry(node.size, 32, 24);
  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: focused ? 1.8 : node.type === "article" ? 1.2 : 0.75,
    metalness: 0.15,
    roughness: 0.22
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(node.position);

  const glowGeometry = new THREE.SphereGeometry(node.size * (focused ? 1.42 : 1.5), 32, 24);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: node.color,
    transparent: true,
    opacity: focused ? 0.11 : 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  mesh.add(glow);

  if (node.type === "article" && !focused) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(node.size * 1.65, 1.15, 10, 80),
      new THREE.MeshBasicMaterial({
        color: "#38bdf8",
        transparent: true,
        opacity: 0.5,
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
  const midpoint = source.position.clone().add(target.position).multiplyScalar(0.5);
  midpoint.y += 36 + source.position.distanceTo(target.position) * 0.1;
  const curve = new THREE.QuadraticBezierCurve3(source.position, midpoint, target.position);
  const color = edgePalette[edge.label] ?? "#7dd3fc";
  if (routeEdgeTypes.has(edge.label)) {
    const group = new THREE.Group();
    group.userData.edgeId = edge.id;
    const geometry = new THREE.TubeGeometry(curve, 44, edge.label === "same_event_as" ? 3.6 : 2.4, 10, false);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: edge.label === "same_event_as" ? 0.78 : 0.54,
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
          opacity: 0.92,
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
    opacity: 0.34,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Line(geometry, material);
}

function addStarField(scene: THREE.Scene) {
  const count = 900;
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
    opacity: 0.32,
    size: 1.5,
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
    <strong>${escapeHtml(shortLabel(node.label))}</strong>
  `;
  return element;
}

function updateHtmlLabels(
  labels: Array<{ element: HTMLDivElement; node: SceneNode }>,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
) {
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  for (const item of labels) {
    const vector = item.node.position.clone();
    vector.y += item.node.size + 22;
    vector.project(camera);
    const visible = vector.z < 1;
    const x = (vector.x * 0.5 + 0.5) * width;
    const y = (-vector.y * 0.5 + 0.5) * height;
    const distance = camera.position.distanceTo(item.node.position);
    const important = ["article", "source", "narrative"].includes(item.node.type) || labels.length <= 24;
    item.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    item.element.style.opacity = visible && (important || distance < 900) ? "1" : "0";
    item.element.style.zIndex = String(Math.max(1, Math.round(3000 - distance)));
  }
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

function NodeDetails({ currentArticleId, node }: { currentArticleId: number; node: GraphNode }) {
  const articleId = Number(node.data.article_id);
  return (
    <div className={styles.details}>
      <span className={`${styles.badge} ${styles[node.type]}`}>{translateNodeType(node.type)}</span>
      <h3>{node.label}</h3>
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
