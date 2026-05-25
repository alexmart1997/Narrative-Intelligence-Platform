import { GraphEdge, GraphNode } from "@/lib/api";
import { GraphMode, SceneNode, entityNodeTypes, routeEdgeTypes } from "./types";

export const nodeTypes = [
  { type: "article", label: "Статья" },
  { type: "source", label: "Источник" },
  { type: "person", label: "Персона" },
  { type: "organization", label: "Организация" },
  { type: "country", label: "Страна" },
  { type: "location", label: "Локация" },
  { type: "concept", label: "Концепт" },
  { type: "narrative", label: "Гипотеза" }
];

export const edgeLabels: Record<string, string> = {
  published_by: "опубликовано",
  mentions: "упоминает",
  relates_to: "связано с",
  sympathizes_with: "симпатизирует",
  criticizes: "критикует",
  supports_narrative: "поддерживает гипотезу",
  same_event_as: "тот же сюжет",
  similar_to: "похожая статья",
  shares_narrative: "общая гипотеза",
  entity_in_article: "содержит объект"
};

export const nodePalette: Record<string, string> = {
  article: "#38bdf8",
  source: "#a7f3d0",
  person: "#fbbf24",
  organization: "#c084fc",
  country: "#22d3ee",
  location: "#2dd4bf",
  concept: "#e0f2fe",
  narrative: "#fb7185"
};

export const edgePalette: Record<string, string> = {
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

export function graphNodeLabel(node: GraphNode | SceneNode | undefined) {
  if (!node) return "";
  const displayLabel = node.data.display_label;
  return typeof displayLabel === "string" && displayLabel.trim() ? displayLabel : node.label;
}

export function nodeConfidence(node: GraphNode) {
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

export function edgeStrength(edge: GraphEdge) {
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

export function translateNodeType(type: string) {
  return nodeTypes.find((item) => item.type === type)?.label ?? type;
}

export function translateEdge(label: string) {
  return edgeLabels[label] ?? label;
}

export function translateGraphMode(mode: GraphMode) {
  const labels: Record<GraphMode, string> = {
    article: "Article",
    similar: "Similar",
    entity: "Entity",
    compare: "Compare",
  };
  return labels[mode];
}

export function translateDataKey(key: string) {
  const labels: Record<string, string> = {
    article_id: "ID статьи",
    source_id: "ID источника",
    source_name: "Источник",
    entity_id: "ID сущности",
    analysis_id: "ID анализа",
    event_id: "ID сюжета",
    url: "Ссылка",
    published_at: "Дата публикации",
    language: "Язык",
    role: "Роль",
    importance_score: "Важность",
    confidence: "Уверенность",
    same_event_probability: "Вероятность того же сюжета",
    score: "Похожесть",
    similarity: "Сходство гипотезы",
    relation_type: "Тип отношения",
    description: "Описание",
    relation_hint: "Причина связи",
    density_score: "Плотность",
    event_article_count: "Статей в сюжете",
    narrative_evidence_count: "Доказательств гипотезы",
    entity_count: "Сущностей",
    relation_count: "Отношений",
    synthetic: "Создано из вывода LLM",
    polarity: "Полярность",
    type: "Тип"
  };
  return labels[key] ?? key;
}

export function formatNumber(value: number) {
  if (!Number.isInteger(value) && value > 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return String(value);
}

export function labelPriority(
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
