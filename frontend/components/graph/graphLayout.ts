import * as THREE from "three";
import { ArticleGraphResponse, GraphEdge, GraphNode } from "@/lib/api";
import { edgeStrength, nodeConfidence, nodePalette } from "./graphEncoding";
import { GraphMode, SceneNode, VisualFilters, entityNodeTypes } from "./types";

export function applyGraphFilters(
  graph: ArticleGraphResponse,
  filters: VisualFilters,
  focusNodeId: string | null
): ArticleGraphResponse {
  const allowedNodeIds = new Set<string>();
  const neighbors = focusNodeId ? buildNeighborMap(graph.edges).get(focusNodeId) ?? new Set<string>() : null;

  for (const node of stableNodes(graph.nodes)) {
    if (!filters.showArticles && node.type === "article") continue;
    if (!filters.showSources && node.type === "source") continue;
    if (!filters.showNarratives && node.type === "narrative") continue;
    if (!filters.showEntities && entityNodeTypes.has(node.type)) continue;
    if (focusNodeId && node.id !== focusNodeId && !neighbors?.has(node.id)) continue;
    allowedNodeIds.add(node.id);
  }

  const edges = stableEdges(graph.edges).filter((edge) => {
    if (!allowedNodeIds.has(edge.source) || !allowedNodeIds.has(edge.target)) return false;
    const strength = edgeStrength(edge);
    if (!filters.showWeakEdges && strength < 0.5) return false;
    return strength >= filters.confidenceThreshold;
  });

  return {
    nodes: stableNodes(graph.nodes).filter((node) => allowedNodeIds.has(node.id)),
    edges,
  };
}

export function buildNeighborMap(edges: GraphEdge[]) {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, new Set());
    if (!map.has(edge.target)) map.set(edge.target, new Set());
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

export function buildSceneNodes(graph: ArticleGraphResponse, activeArticleId: number, mode: GraphMode): SceneNode[] {
  const activeId = `article_${activeArticleId}`;
  const nodes = stableNodes(graph.nodes);
  const focusEntity = nodes.find((node) => Boolean(node.data.is_focus));
  const relatedArticles = nodes.filter((node) => node.type === "article" && node.id !== activeId);
  const entities = nodes.filter((node) => !["article", "source", "narrative"].includes(node.type) && node.id !== focusEntity?.id);
  const sources = nodes.filter((node) => node.type === "source");
  const narratives = nodes.filter((node) => node.type === "narrative");
  const active = nodes.find((node) => node.id === activeId);
  const result: SceneNode[] = [];

  if (mode === "entity" || focusEntity) {
    if (focusEntity) result.push(toSceneNode(focusEntity, new THREE.Vector3(0, 0, 0), true));
    if (active) result.push(toSceneNode(active, new THREE.Vector3(-105, 18, 82), !focusEntity));
    relatedArticles.forEach((node, index) => {
      const angle = stableAngle(index, relatedArticles.length);
      const radius = 205 + (index % 3) * 28;
      const y = Math.sin(index * 1.15) * 62;
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), false));
    });
    addSecondaryGroups(result, { sources, narratives, entities });
    return centerSceneNodes(result);
  }

  if (mode === "similar") {
    if (active) result.push(toSceneNode(active, new THREE.Vector3(0, 0, 0), true));
    relatedArticles.forEach((node, index) => {
      const angle = Math.PI * 0.08 + (index / Math.max(relatedArticles.length - 1, 1)) * Math.PI * 0.86;
      const radius = 235 + (index % 2) * 34;
      const y = -24 + Math.sin(index * 0.9) * 78;
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, -126 + Math.sin(angle) * radius), false));
    });
    addSecondaryGroups(result, { sources, narratives, entities: entities.slice(0, 12) });
    return centerSceneNodes(result);
  }

  if (mode === "compare") {
    if (active) result.push(toSceneNode(active, new THREE.Vector3(0, 0, 0), true));
    sources.forEach((node, index) => {
      const angle = stableAngle(index, sources.length);
      result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * 250, Math.sin(index) * 56, Math.sin(angle) * 250), false));
    });
    relatedArticles.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(-280, (index - relatedArticles.length / 2) * 92, -110), false)));
    narratives.forEach((node, index) => result.push(toSceneNode(node, new THREE.Vector3(300, (index - narratives.length / 2) * 88, -90), false)));
    entities.forEach((node, index) => result.push(radialNode(node, index, entities.length, 165 + (index % 3) * 34, 76, false)));
    return centerSceneNodes(result);
  }

  if (active) result.push(toSceneNode(active, new THREE.Vector3(0, 0, 0), true));
  addSecondaryGroups(result, { sources, narratives, entities });
  relatedArticles.forEach((node, index) => {
    const angle = Math.PI * 0.1 + (index / Math.max(relatedArticles.length - 1, 1)) * Math.PI * 0.82;
    const radius = 235 + (index % 2) * 34;
    const y = -42 + Math.sin(index * 0.9) * 78;
    result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, -126 + Math.sin(angle) * radius), false));
  });

  return centerSceneNodes(result);
}

export function centerSceneNodes(nodes: SceneNode[]) {
  if (nodes.length === 0) return nodes;
  const bounds = new THREE.Box3().setFromPoints(nodes.map((node) => node.position));
  const center = bounds.getCenter(new THREE.Vector3());
  // Центрируем всю карту, чтобы стартовая сцена не уезжала вниз/вбок.
  for (const node of nodes) {
    node.position.sub(center);
    node.position.y += 28;
  }
  return nodes;
}

function addSecondaryGroups(
  result: SceneNode[],
  groups: { sources: GraphNode[]; narratives: GraphNode[]; entities: GraphNode[] }
) {
  groups.sources.forEach((node, index) => {
    const spread = (index - (groups.sources.length - 1) / 2) * 72;
    result.push(toSceneNode(node, new THREE.Vector3(-190, 58 + spread, -78 - index * 20), false));
  });

  groups.narratives.forEach((node, index) => {
    const spread = (index - (groups.narratives.length - 1) / 2) * 82;
    result.push(toSceneNode(node, new THREE.Vector3(205, -52 + spread, -92 + index * 28), false));
  });

  groups.entities.forEach((node, index) => {
    const angle = stableAngle(index, groups.entities.length);
    const radius = 150 + (index % 4) * 30;
    const y = Math.sin(index * 1.73) * 68;
    result.push(toSceneNode(node, new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), false));
  });
}

function radialNode(node: GraphNode, index: number, count: number, radius: number, yScale: number, focused: boolean) {
  const angle = stableAngle(index, count);
  return toSceneNode(
    node,
    new THREE.Vector3(Math.cos(angle) * radius, Math.sin(index * 1.3) * yScale, Math.sin(angle) * radius),
    focused,
  );
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

function stableAngle(index: number, count: number) {
  return (index / Math.max(count, 1)) * Math.PI * 2;
}

function stableNodes(nodes: GraphNode[]) {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function stableEdges(edges: GraphEdge[]) {
  return [...edges].sort((left, right) => left.id.localeCompare(right.id));
}
