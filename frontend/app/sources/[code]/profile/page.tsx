"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SourceProfileResponse, getSourceProfile } from "@/lib/api";
import styles from "./page.module.css";

const sentimentLabels = ["positive", "negative", "neutral", "mixed"] as const;

export default function SourceProfilePage() {
  const params = useParams<{ code: string }>();
  const sourceCode = params.code;
  const [profile, setProfile] = useState<SourceProfileResponse | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [language, setLanguage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      setProfile(
        await getSourceProfile(sourceCode, {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          language: language || undefined
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить профиль источника");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCode]);

  const sentimentTotal = useMemo(() => {
    if (!profile) return 0;
    return sentimentLabels.reduce((sum, key) => sum + (profile.sentiment_distribution[key] ?? 0), 0);
  }, [profile]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Back to articles
          </Link>
          <p className={styles.eyebrow}>Source Profile Analytics</p>
          <h1>{profile?.source.name ?? sourceCode}</h1>
          <p className={styles.subtitle}>
            Narratives, frames, actors and tone patterns for this source.
          </p>
        </div>
        <button className={styles.primaryButton} onClick={loadProfile} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </header>

      <section className={styles.filters}>
        <label>
          Date from
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          Date to
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">All</option>
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>
        </label>
        <button className={styles.primaryButton} onClick={loadProfile} disabled={loading}>
          Apply
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.state}>Loading source profile...</div> : null}

      {profile ? (
        <>
          <section className={styles.summary}>
            <Stat label="Articles" value={profile.articles_count.toString()} />
            <Stat label="Top entities" value={profile.top_entities.length.toString()} />
            <Stat label="Frames" value={profile.top_framings.length.toString()} />
            <Stat label="Narratives" value={profile.top_narratives.length.toString()} />
          </section>

          <section className={styles.dashboard}>
            <article className={styles.card}>
              <h2>Sentiment distribution</h2>
              <div className={styles.sentiments}>
                {sentimentLabels.map((key) => {
                  const count = profile.sentiment_distribution[key] ?? 0;
                  const percent = sentimentTotal ? Math.round((count / sentimentTotal) * 100) : 0;
                  return (
                    <div className={styles.sentimentRow} key={key}>
                      <div>
                        <strong>{key}</strong>
                        <span>{count} articles</span>
                      </div>
                      <div className={styles.barTrack}>
                        <span className={`${styles.bar} ${styles[key]}`} style={{ width: `${percent}%` }} />
                      </div>
                      <em>{percent}%</em>
                    </div>
                  );
                })}
              </div>
            </article>

            <TopList
              title="Top entities"
              items={profile.top_entities.map((item) => ({
                label: item.name,
                meta: item.type,
                count: item.count
              }))}
            />
            <TopList
              title="Top frames"
              items={profile.top_framings.map((item) => ({
                label: item.framing,
                count: item.count
              }))}
            />
            <TopList
              title="Top narrative hypotheses"
              items={profile.top_narrative_hypotheses.map((item) => ({
                label: item.text,
                count: item.count
              }))}
              wide
            />
            <TopList
              title="Sympathizes with"
              items={profile.sympathizes_with_top.map((item) => ({
                label: item.target,
                count: item.count
              }))}
            />
            <TopList
              title="Criticizes"
              items={profile.criticizes_top.map((item) => ({
                label: item.target,
                count: item.count
              }))}
            />
          </section>
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TopList({
  items,
  title,
  wide
}: {
  items: Array<{ label: string; meta?: string; count: number }>;
  title: string;
  wide?: boolean;
}) {
  return (
    <article className={`${styles.card} ${wide ? styles.wide : ""}`}>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No data yet.</p>
      ) : (
        <ul className={styles.topList}>
          {items.map((item) => (
            <li key={`${title}-${item.label}`}>
              <div>
                <strong>{item.label}</strong>
                {item.meta ? <span>{item.meta}</span> : null}
              </div>
              <em>{item.count}</em>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
