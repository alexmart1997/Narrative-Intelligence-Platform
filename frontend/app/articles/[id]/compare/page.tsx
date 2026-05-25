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
  russianTitle: string;
  originalTitle: string;
  originalUrl: string | null;
  summary: string | null;
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
                  russianTitle: `Статья ${item.article_id}`,
                  originalTitle: `Article ${item.article_id}`,
                  originalUrl: null,
                  summary: null,
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
          <h1>{sourceArticle ? getArticleTitle(sourceArticle) : `Статья ${params.id}`}</h1>
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
  const [showOriginal, setShowOriginal] = useState(false);
  const russianLead = getArticleTitle(article);
  const hasOriginal = Boolean(article.originalTitle.trim());
  const leadText = showOriginal ? article.originalTitle : russianLead;

  return (
    <section className={styles.sourceColumn}>
      <div className={styles.sourceHead}>
        <div>
          <span>{title}</span>
          <h3>{article.sourceName}</h3>
        </div>
        <div className={styles.sourceActions}>
          {hasOriginal ? (
            <button className={styles.textToggle} type="button" onClick={() => setShowOriginal((current) => !current)}>
              {showOriginal ? "На русском" : "Оригинал"}
            </button>
          ) : null}
          <Link className={styles.graphLink} href={`/articles/${article.id}/graph`}>
            Граф
          </Link>
        </div>
      </div>
      <p className={styles.articleTitle}>{leadText}</p>
      {!showOriginal && article.summary ? <p className={styles.articleSummary}>{article.summary}</p> : null}
      {showOriginal && article.originalUrl ? (
        <a className={styles.originalLink} href={article.originalUrl} rel="noreferrer" target="_blank">
          Открыть публикацию источника
        </a>
      ) : null}
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
      <em className={`${styles.badge} ${styles[tone]}`}>{metricToneLabel(tone)}</em>
    </div>
  );
}

function InfoBlock({ label, tone, value }: { label: string; tone?: string; value: string }) {
  const displayValue = normalizeRussianText(value);

  return (
    <div className={styles.infoBlock}>
      <span>
        {label}
        {tone ? <em className={`${styles.smallBadge} ${styles[tone]}`}>{analysisToneLabel(label, tone)}</em> : null}
      </span>
      <p>{displayValue || "Не указано"}</p>
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
  const displayLabel = graphNodeDisplayLabel(article);
  const originalLabel = article?.label?.trim() ?? "";
  const originalUrl = graphNodeString(article, "url");
  const summary = getDisplaySummary(displayLabel, originalLabel);

  return {
    id: articleId,
    russianTitle: translateHeadline(originalLabel || displayLabel || `Статья ${articleId}`),
    originalTitle: originalLabel || displayLabel || `Article ${articleId}`,
    originalUrl,
    summary,
    sourceName: source?.label ?? `Source ${articleId}`
  };
}

function graphNodeDisplayLabel(node: ArticleGraphResponse["nodes"][number] | undefined) {
  if (!node) return "";
  const displayLabel = node.data.display_label;
  return typeof displayLabel === "string" && displayLabel.trim() ? displayLabel : node.label;
}

function graphNodeString(node: ArticleGraphResponse["nodes"][number] | undefined, key: string) {
  const value = node?.data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getArticleTitle(article: ArticleBrief) {
  return article.russianTitle.trim() || article.originalTitle || `Статья ${article.id}`;
}

function getDisplaySummary(displayLabel: string, originalLabel: string) {
  const label = displayLabel.trim();
  if (!label || label === originalLabel) return null;
  if (!isLikelySummary(label)) return null;
  if (!hasCyrillic(label)) return null;
  return normalizeRussianText(label);
}

function isLikelySummary(value: string) {
  return value.length > 140 || value.split(".").length > 2;
}

function hasCyrillic(value: string) {
  return /[А-Яа-яЁё]/.test(value);
}

function translateHeadline(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (hasCyrillic(trimmed)) return trimmed;

  const exactTranslations: Array<[RegExp, string]> = [
    [
      /^Trump says Iran deal 'largely negotiated' including reopening Strait of Hormuz$/i,
      "Трамп заявил, что сделка с Ираном «в основном согласована» и включает открытие Ормузского пролива"
    ],
    [
      /^Live updates: Iran peace deal and Strait of Hormuz agreement ‘still a work in progress,’ says Rubio \| CNN$/i,
      "Рубио заявил, что мирное соглашение с Ираном и договоренность по Ормузскому проливу еще прорабатываются"
    ],
    [
      /^Live updates: Iran peace deal and Strait of Hormuz agreement 'still a work in progress,' says Rubio \| CNN$/i,
      "Рубио заявил, что мирное соглашение с Ираном и договоренность по Ормузскому проливу еще прорабатываются"
    ]
  ];
  const exact = exactTranslations.find(([pattern]) => pattern.test(trimmed));
  if (exact) return exact[1];

  return normalizeRussianText(trimmed);
}

function normalizeRussianText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (hasCyrillic(trimmed)) return trimmed;

  const replacements: Array<[RegExp, string]> = [
    [/\bUS President Donald Trump\b/gi, "президент США Дональд Трамп"],
    [/\bPresident Donald Trump\b/gi, "президент Дональд Трамп"],
    [/\bDonald Trump\b/gi, "Дональд Трамп"],
    [/\bPakistan's Prime Minister Shehbaz Sharif\b/gi, "премьер-министр Пакистана Шехбаз Шариф"],
    [/\bShehbaz Sharif\b/gi, "Шехбаз Шариф"],
    [/\bIranian foreign ministry spokesman Esmail Baghaei\b/gi, "представитель МИД Ирана Эсмаил Багаи"],
    [/\bEsmail Baghaei\b/gi, "Эсмаил Багаи"],
    [/\bIran's control over the Strait of Hormuz\b/gi, "контроль Ирана над Ормузским проливом"],
    [/\bStrait of Hormuz\b/gi, "Ормузский пролив"],
    [/\bUnited States\b/gi, "США"],
    [/\bUSA\b/gi, "США"],
    [/\bUS\b/gi, "США"],
    [/\bIranian\b/gi, "иранский"],
    [/\bIran\b/gi, "Иран"],
    [/\bPakistan\b/gi, "Пакистан"],
    [/\bRussia\b/gi, "Россия"],
    [/\bUkraine\b/gi, "Украина"],
    [/\bIsrael\b/gi, "Израиль"],
    [/\bHamas\b/gi, "ХАМАС"],
    [/\bNATO\b/gi, "НАТО"],
    [/\bPrime Minister\b/gi, "премьер-министр"],
    [/\bPresident\b/gi, "президент"],
    [/\bforeign ministry spokesman\b/gi, "представитель МИД"]
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), trimmed);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function probabilityTone(value: number) {
  if (value >= 0.7) return "positive";
  if (value <= 0.4) return "negative";
  return "neutral";
}

function metricToneLabel(tone: string) {
  if (tone === "positive") return "высокое";
  if (tone === "negative") return "низкое";
  return "среднее";
}

function analysisToneLabel(label: string, tone: string) {
  if (tone === "neutral") return "нет";
  if (label.toLowerCase().includes("крит")) return "критика";
  if (label.toLowerCase().includes("симпат")) return "симпатия";
  return tone === "negative" ? "негатив" : "позитив";
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
