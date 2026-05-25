import { GraphEdge, GraphNode } from "@/lib/api";
import {
  formatNumber,
  graphNodeLabel,
  nodeConfidence,
  translateDataKey,
  translateEdge,
  translateNodeType
} from "./graphEncoding";

type GraphStyles = Record<string, string>;

type NarrativeSignal = {
  id: string;
  title: string;
  confidence: number;
  evidenceCount: number;
};

export function GraphDetailsPanel({
  currentArticleId,
  selectedEdge,
  selectedNode,
  signals,
  styles
}: {
  currentArticleId: number;
  selectedEdge: GraphEdge | null;
  selectedNode: GraphNode | null;
  signals: NarrativeSignal[];
  styles: GraphStyles;
}) {
  return (
    <aside className={styles.detailPanel}>
      <div className={styles.panelHeader}>
        <span>Inspector</span>
        <h2>Контекст</h2>
      </div>
      {selectedNode ? <NodeDetails node={selectedNode} currentArticleId={currentArticleId} styles={styles} /> : null}
      {selectedEdge ? <EdgeDetails edge={selectedEdge} styles={styles} /> : null}
      {!selectedNode && !selectedEdge ? (
        <p className={styles.hint}>
          Кликни по статье, чтобы перейти в ее граф. Клик по персоне, организации,
          стране или концепту перестроит сцену вокруг новостей с этим объектом.
        </p>
      ) : null}
      <NarrativeSignals signals={signals} styles={styles} />
    </aside>
  );
}

export function buildNarrativeSignals(graph: { nodes: GraphNode[] } | null): NarrativeSignal[] {
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
}

function NarrativeSignals({ signals, styles }: { signals: NarrativeSignal[]; styles: GraphStyles }) {
  return (
    <section className={styles.narrativeSignals}>
      <div>
        <span>Гипотезы</span>
        <h3>Смысловые линии</h3>
      </div>
      {signals.length > 0 ? (
        <div className={styles.narrativeSignalList}>
          {signals.slice(0, 3).map((signal) => (
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
          В этой сцене нет устойчивой общей гипотезы.
        </p>
      )}
    </section>
  );
}

function NodeDetails({ currentArticleId, node, styles }: { currentArticleId: number; node: GraphNode; styles: GraphStyles }) {
  const articleId = Number(node.data.article_id);
  const meta = curatedNodeEntries(node);
  return (
    <div className={styles.details}>
      <span className={`${styles.badge} ${styles[node.type]}`}>{translateNodeType(node.type)}</span>
      <h3>{graphNodeLabel(node)}</h3>
      {node.type === "article" && Number.isFinite(articleId) && articleId !== currentArticleId ? (
        <p className={styles.hint}>Клик по этой статье перестроит 3D-сцену вокруг нее.</p>
      ) : null}
      {meta.length > 0 ? <KeyFacts entries={meta} styles={styles} /> : null}
    </div>
  );
}

function EdgeDetails({ edge, styles }: { edge: GraphEdge; styles: GraphStyles }) {
  const meta = curatedEdgeEntries(edge);
  return (
    <div className={styles.details}>
      <span className={styles.edgeBadge}>{translateEdge(edge.label)}</span>
      <h3>{translateEdge(edge.label)}</h3>
      <KeyFacts entries={meta} styles={styles} />
    </div>
  );
}

function KeyFacts({ entries, styles }: { entries: Array<[string, unknown]>; styles: GraphStyles }) {
  return (
    <dl className={styles.keyFacts}>
      {entries.map(([key, value]) => (
        <DisplayValue key={key} label={translateDataKey(key)} value={value} />
      ))}
    </dl>
  );
}

function DisplayValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? formatNumber(value) : String(value);
  return (
    <div>
      <dt>{label}</dt>
      <dd>{shortValue(text)}</dd>
    </div>
  );
}

function curatedNodeEntries(node: GraphNode): Array<[string, unknown]> {
  const keysByType: Record<string, string[]> = {
    article: ["source_name", "published_at", "language", "density_score", "entity_count", "relation_count"],
    source: ["url"],
    narrative: ["confidence", "narrative_evidence_count", "analysis_id"],
    person: ["role", "importance_score", "entity_id"],
    organization: ["role", "importance_score", "entity_id"],
    country: ["role", "importance_score", "entity_id"],
    location: ["role", "importance_score", "entity_id"],
    concept: ["role", "importance_score", "entity_id"],
  };
  const keys = keysByType[node.type] ?? ["confidence", "importance_score"];
  return keys
    .map((key) => [key, node.data[key]] as [string, unknown])
    .filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function curatedEdgeEntries(edge: GraphEdge): Array<[string, unknown]> {
  return [
    ["type", translateEdge(edge.label)],
    ["source", edge.source],
    ["target", edge.target],
    ["confidence", edge.data.confidence ?? edge.data.same_event_probability ?? edge.data.similarity ?? edge.data.score],
    ["description", edge.data.description],
    ["relation_type", edge.data.relation_type],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "") as Array<[string, unknown]>;
}

function shortValue(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
