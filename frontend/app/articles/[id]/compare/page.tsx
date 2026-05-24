"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArticleGraphResponse,
  CompareWithSimilarItem,
  compareWithSimilar,
  getArticleGraph
} from "@/lib/api";
import styles from "./page.module.css";

type ArticleBrief = {
  id: number;
  title: string;
  sourceName: string;
};

type ComparisonCard = {
  item: CompareWithSimilarItem;
  sourceArticle: ArticleBrief;
  targetArticle: ArticleBrief;
};

export default function ComparePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const articleId = Number(params.id);
  const [cards, setCards] = useState<ComparisonCard[]>([]);
  const [sourceArticle, setSourceArticle] = useState<ArticleBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const strongestDifference = useMemo(() => {
    return cards.some((card) => hasStrongDivergence(card.item.comparison.same_event_probability, card.item.comparison.fact_overlap));
  }, [cards]);

  useEffect(() => {
    async function loadComparisons() {
      setLoading(true);
      setError(null);
      try {
        const [comparisonResponse, sourceGraph] = await Promise.all([
          compareWithSimilar(articleId),
          getArticleGraph(articleId)
        ]);
        const sourceBrief = graphToBrief(articleId, sourceGraph);
        const targetGraphs = await Promise.all(
          comparisonResponse.items.map((item) =>
            getArticleGraph(item.article_id).catch(() => null)
          )
        );

        setSourceArticle(sourceBrief);
        setCards(
          comparisonResponse.items.map((item, index) => ({
            item,
            sourceArticle: sourceBrief,
            targetArticle: targetGraphs[index]
              ? graphToBrief(item.article_id, targetGraphs[index] as ArticleGraphResponse)
              : {
                  id: item.article_id,
                  title: `Article ${item.article_id}`,
                  sourceName: `Source ${item.article_id}`
                }
          }))
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить сравнения");
      } finally {
        setLoading(false);
      }
    }

    if (Number.isFinite(articleId)) {
      loadComparisons();
    } else {
      setError("Некорректный ID статьи");
      setLoading(false);
    }
  }, [articleId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Назад к статьям
          </Link>
          <p className={styles.eyebrow}>Сравнение освещения</p>
          <h1>{sourceArticle?.title ?? `Article ${params.id}`}</h1>
        </div>
        <button className={styles.primaryButton} onClick={() => router.push(`/articles/${articleId}/graph`)}>
          Открыть граф
        </button>
      </header>

      {loading ? <div className={styles.state}>Загружаю сравнение через Ollama...</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && cards.length === 0 ? (
        <div className={styles.state}>Пока нет похожих статей для сравнения.</div>
      ) : null}

      {strongestDifference ? (
        <section className={styles.alert}>
          Найдено сильное расхождение: статьи похожи по событию, но факты или фрейминг заметно отличаются.
        </section>
      ) : null}

      <section className={styles.grid}>
        {cards.map((card) => (
          <ComparisonCardView key={card.item.article_id} card={card} />
        ))}
      </section>
    </main>
  );
}

function ComparisonCardView({ card }: { card: ComparisonCard }) {
  const comparison = card.item.comparison;
  const sameEventTone = probabilityTone(comparison.same_event_probability);
  const overlapTone = probabilityTone(comparison.fact_overlap);
  const divergence = hasStrongDivergence(comparison.same_event_probability, comparison.fact_overlap);

  return (
    <article className={`${styles.card} ${divergence ? styles.strongDivergence : ""}`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.kicker}>Сходство {formatPercent(card.item.similarity_score)}</p>
          <h2>{card.sourceArticle.sourceName} vs {card.targetArticle.sourceName}</h2>
        </div>
        {divergence ? <span className={styles.warningBadge}>сильное расхождение</span> : null}
      </div>

      <div className={styles.metrics}>
        <Metric label="То же событие" value={comparison.same_event_probability} tone={sameEventTone} />
        <Metric label="Совпадение фактов" value={comparison.fact_overlap} tone={overlapTone} />
      </div>

      <div className={styles.sources}>
        <SourceColumn
          title="Источник 1"
          article={card.sourceArticle}
          framing={comparison.source_1_framing}
          sympathy={comparison.source_1_sympathy}
          criticism={comparison.source_1_criticism}
        />
        <SourceColumn
          title="Источник 2"
          article={card.targetArticle}
          framing={comparison.source_2_framing}
          sympathy={comparison.source_2_sympathy}
          criticism={comparison.source_2_criticism}
        />
      </div>

      <section className={styles.narrative}>
        <span>Разница нарративов</span>
        <p>{comparison.narrative_difference}</p>
      </section>

      <div className={styles.lists}>
        <FactList title="Общие факты" items={comparison.main_common_facts} />
        <FactList title="Отличия" items={comparison.differences} emphasis />
      </div>

      <section className={styles.conclusion}>
        <h3>Вывод</h3>
        <p>{comparison.conclusion}</p>
      </section>
    </article>
  );
}

function SourceColumn({
  article,
  criticism,
  framing,
  sympathy,
  title
}: {
  article: ArticleBrief;
  criticism: string;
  framing: string;
  sympathy: string;
  title: string;
}) {
  return (
    <section className={styles.sourceColumn}>
      <div className={styles.sourceHead}>
        <div>
          <span>{title}</span>
          <h3>{article.sourceName}</h3>
        </div>
        <Link className={styles.graphLink} href={`/articles/${article.id}/graph`}>
          Граф
        </Link>
      </div>
      <p className={styles.articleTitle}>{article.title}</p>
      <InfoBlock label="Фрейминг" value={framing} />
      <InfoBlock label="Симпатия" value={sympathy} tone={sentimentTone(sympathy)} />
      <InfoBlock label="Критика" value={criticism} tone={sentimentTone(criticism, true)} />
    </section>
  );
}

function Metric({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{formatPercent(value)}</strong>
      <em className={`${styles.badge} ${styles[tone]}`}>{tone}</em>
    </div>
  );
}

function InfoBlock({ label, tone, value }: { label: string; tone?: string; value: string }) {
  return (
    <div className={styles.infoBlock}>
      <span>
        {label}
        {tone ? <em className={`${styles.smallBadge} ${styles[tone]}`}>{tone}</em> : null}
      </span>
      <p>{value || "Не указано"}</p>
    </div>
  );
}

function FactList({ emphasis, items, title }: { emphasis?: boolean; items: string[]; title: string }) {
  return (
    <section className={styles.factList}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className={styles.empty}>Нет данных.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li className={emphasis ? styles.emphasisItem : ""} key={item}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function graphToBrief(articleId: number, graph: ArticleGraphResponse): ArticleBrief {
  const article = graph.nodes.find((node) => node.type === "article");
  const source = graph.nodes.find((node) => node.type === "source");
  return {
    id: articleId,
    title: graphNodeLabel(article) || `Статья ${articleId}`,
    sourceName: source?.label ?? `Source ${articleId}`
  };
}

function graphNodeLabel(node: ArticleGraphResponse["nodes"][number] | undefined) {
  if (!node) return "";
  const displayLabel = node.data.display_label;
  return typeof displayLabel === "string" && displayLabel.trim() ? displayLabel : node.label;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function probabilityTone(value: number) {
  if (value >= 0.7) return "positive";
  if (value <= 0.4) return "negative";
  return "neutral";
}

function hasStrongDivergence(sameEventProbability: number, factOverlap: number) {
  return sameEventProbability <= 0.35 || (sameEventProbability >= 0.65 && factOverlap <= 0.45);
}

function sentimentTone(value: string, invert = false) {
  const lower = value.toLowerCase();
  if (!value.trim() || lower.includes("neutral") || lower.includes("нейтраль")) return "neutral";
  if (lower.includes("none") || lower.includes("нет") || lower.includes("not specified")) return "neutral";
  return invert ? "negative" : "positive";
}
