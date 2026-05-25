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
      <h2>Детали</h2>
      <NarrativeSignals signals={signals} styles={styles} />
      <div className={styles.readingGuide}>
        <strong>Как читать сцену</strong>
        <p>Шарик = объект анализа: статья, источник, участник или гипотеза.</p>
        <p>Размер статьи = плотность: сколько вокруг нее evidence, сущностей и связей.</p>
        <p>Дуга = тип связи. Яркие дуги показывают тот же сюжет, похожую статью или общую гипотезу.</p>
      </div>
      {selectedNode ? <NodeDetails node={selectedNode} currentArticleId={currentArticleId} styles={styles} /> : null}
      {selectedEdge ? <EdgeDetails edge={selectedEdge} styles={styles} /> : null}
      {!selectedNode && !selectedEdge ? (
        <p className={styles.hint}>
          Кликни по статье, чтобы перейти в ее граф. Клик по персоне, организации,
          стране или концепту перестроит сцену вокруг новостей с этим объектом.
        </p>
      ) : null}
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
          Для этой сцены пока нет общей гипотезы. Запусти анализ статьи, чтобы система
          показала смысловые линии прямо внутри графа.
        </p>
      )}
    </section>
  );
}

function NodeDetails({ currentArticleId, node, styles }: { currentArticleId: number; node: GraphNode; styles: GraphStyles }) {
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

function EdgeDetails({ edge, styles }: { edge: GraphEdge; styles: GraphStyles }) {
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
