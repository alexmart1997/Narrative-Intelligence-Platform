"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArticleListItem,
  SimilarArticleItem,
  SourceInfo,
  analyzeArticle,
  detectArticleEvent,
  embedArticle,
  getArticles,
  getSimilarArticles,
  getSources
} from "@/lib/api";
import styles from "./page.module.css";

type ActionState = {
  articleId: number;
  action: ArticleAction;
} | null;

type ArticleAction = "analysis" | "analyze" | "compare" | "graph" | "similar";

export default function ArticlesPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceCode, setSourceCode] = useState("");
  const [language, setLanguage] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [noticeByArticle, setNoticeByArticle] = useState<Record<number, string>>({});
  const [similarByArticle, setSimilarByArticle] = useState<Record<number, SimilarArticleItem[]>>({});

  const languages = useMemo(() => ["ru", "en"], []);

  async function loadArticles() {
    setLoading(true);
    setError(null);
    try {
      const [sourceList, articleList] = await Promise.all([
        getSources(),
        getArticles({ sourceCode, language, q: query })
      ]);
      setSources(sourceList);
      setArticles(articleList.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить статьи");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAnalyze(articleId: number) {
    setActionState({ articleId, action: "analyze" });
    setActionMessage("Запускаю LLM-анализ...");
    setError(null);
    setNoticeByArticle((current) => ({ ...current, [articleId]: "" }));
    try {
      await analyzeArticle(articleId);
      setActionMessage("Создаю embedding для поиска похожих материалов...");
      await embedArticle(articleId);
      setActionMessage("Пробую связать статью с событием...");
      await detectArticleEvent(articleId);
      await loadArticles();
      setNoticeByArticle((current) => ({
        ...current,
        [articleId]: "Анализ готов: добавлены сущности, нарратив, embedding и связь с событием."
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setActionState(null);
      setActionMessage(null);
    }
  }

  function handleOpenGraph(articleId: number) {
    router.push(`/articles/${articleId}/graph`);
  }

  function handleCompare(articleId: number) {
    router.push(`/articles/${articleId}/compare`);
  }

  function handleOpenAnalysis(articleId: number) {
    router.push(`/articles/${articleId}/analysis`);
  }

  async function handleFindSimilar(articleId: number) {
    setActionState({ articleId, action: "similar" });
    setError(null);
    try {
      const response = await getSimilarArticles(articleId);
      setSimilarByArticle((current) => ({ ...current, [articleId]: response.items }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось найти похожие статьи");
    } finally {
      setActionState(null);
    }
  }

  function actionLabel(articleId: number, action: ArticleAction) {
    if (actionState?.articleId === articleId && actionState.action === action) {
      return action === "analyze" ? "Анализируется..." : "Загрузка...";
    }
    if (action === "analysis") return "Открыть анализ";
    if (action === "analyze") return "Анализировать";
    if (action === "compare") return "Сравнить";
    if (action === "graph") return "Открыть граф";
    return "Найти похожие";
  }

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Narrative Intelligence</p>
          <h1>Статьи</h1>
        </div>
        <button className={styles.primaryButton} onClick={loadArticles} disabled={loading}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
      </section>

      <section className={styles.filters} aria-label="Article filters">
        <label>
          Источник
          <select value={sourceCode} onChange={(event) => setSourceCode(event.target.value)}>
            <option value="">Все источники</option>
            {sources.map((source) => (
              <option key={source.code} value={source.code}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Язык
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">Все языки</option>
            {languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.searchLabel}>
          Поиск по заголовку и тексту
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="например: выборы, Молдавия, НАТО"
          />
        </label>

        <button className={styles.primaryButton} onClick={loadArticles} disabled={loading}>
          Применить
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {actionMessage ? <div className={styles.loading}>{actionMessage}</div> : null}

      <section className={styles.content}>
        <div className={styles.list}>
          {loading ? (
            <div className={styles.loading}>Загружаю статьи...</div>
          ) : articles.length === 0 ? (
            <div className={styles.empty}>Статьи не найдены.</div>
          ) : (
            articles.map((article) => (
              <article className={styles.card} key={article.id}>
                <div className={styles.cardMeta}>
                  {article.source_code ? (
                    <Link href={`/sources/${article.source_code}/profile`}>{article.source_name}</Link>
                  ) : (
                    <span>{article.source_name}</span>
                  )}
                  <span>{article.language}</span>
                  <span>{formatDate(article.published_at)}</span>
                  <span className={article.has_analysis ? styles.readyBadge : styles.waitBadge}>
                    {article.has_analysis ? "анализ готов" : "без анализа"}
                  </span>
                  {article.has_event ? <span className={styles.readyBadge}>есть событие</span> : null}
                </div>
                <h2>{article.title}</h2>
                <p>{article.text_preview}</p>
                <div className={styles.actions}>
                  <button
                    onClick={() => handleAnalyze(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "analyze")}
                  </button>
                  <button
                    onClick={() => handleOpenAnalysis(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "analysis")}
                  </button>
                  <button
                    onClick={() => handleOpenGraph(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "graph")}
                  </button>
                  <button
                    onClick={() => handleCompare(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "compare")}
                  </button>
                  <button
                    onClick={() => handleFindSimilar(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "similar")}
                  </button>
                </div>
                {noticeByArticle[article.id] ? (
                  <div className={styles.success}>{noticeByArticle[article.id]}</div>
                ) : null}
                {similarByArticle[article.id] ? (
                  <div className={styles.similar}>
                    <h3>Похожие статьи</h3>
                    {similarByArticle[article.id].length === 0 ? (
                      <p>Похожие статьи пока не найдены. Сначала нужны embedding-и в Qdrant.</p>
                    ) : (
                      <ul>
                        {similarByArticle[article.id].map((item) => (
                          <li key={`${article.id}-${item.article_id}`}>
                            <strong>{item.source_name}</strong> · {item.title} · score{" "}
                            {item.score.toFixed(3)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>

        <aside className={styles.graphPanel}>
          <h2>Граф связей</h2>
          <p>
            Открой граф, чтобы увидеть источник, участников, нарратив,
            связи с похожими материалами и статьи того же события.
          </p>
        </aside>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
