"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EventDetailResponse, getEvent } from "@/lib/api";
import styles from "./page.module.css";

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const [event, setEvent] = useState<EventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvent() {
      setLoading(true);
      setError(null);
      try {
        setEvent(await getEvent(eventId));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить событие");
      } finally {
        setLoading(false);
      }
    }

    if (Number.isFinite(eventId)) {
      loadEvent();
    }
  }, [eventId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/articles">Назад к статьям</Link>
        <p>Event Intelligence</p>
        <h1>{event?.title ?? `Событие ${eventId}`}</h1>
        {event ? <span>{formatDate(event.event_date)} · {event.event_type ?? "type pending"} · {event.location ?? "location pending"}</span> : null}
      </header>

      {loading ? <section className={styles.panel}>Загружаю событие...</section> : null}
      {error ? <section className={styles.error}>{error}</section> : null}

      {event ? (
        <section className={styles.grid}>
          <article className={styles.panel}>
            <p className={styles.kicker}>Описание</p>
            <p>{event.description}</p>
          </article>

          <article className={styles.panel}>
            <p className={styles.kicker}>Главные сущности</p>
            <div className={styles.chips}>
              {event.entities.length > 0 ? event.entities.map((entity) => (
                <span key={entity.entity_id}>
                  {entity.name}
                  <small>{entity.type}{entity.importance_score ? ` · ${Math.round(entity.importance_score * 100)}%` : ""}</small>
                </span>
              )) : <em>Сущности пока не рассчитаны</em>}
            </div>
          </article>

          <section className={styles.panelWide}>
            <div className={styles.sectionTitle}>
              <div>
                <p className={styles.kicker}>Supporting articles</p>
                <h2>{event.articles.length} материалов</h2>
              </div>
              <span>вероятность = насколько статья описывает это же событие</span>
            </div>
            <div className={styles.articleList}>
              {event.articles.map((article) => (
                <article key={article.article_id}>
                  <div>
                    <strong>{article.article_title}</strong>
                    <span>{article.source_name} · {formatDate(article.published_at)}</span>
                    {article.evidence_text ? <p>{article.evidence_text}</p> : null}
                  </div>
                  <div className={styles.articleActions}>
                    <b>{Math.round(article.same_event_probability * 100)}%</b>
                    <Link href={`/articles/${article.article_id}/graph`}>3D Graph</Link>
                    <Link href={`/articles/${article.article_id}/compare`}>Compare</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}

function formatDate(value: string | null) {
  if (!value) return "date pending";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
