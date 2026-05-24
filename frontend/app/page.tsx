import Link from "next/link";
import styles from "./page.module.css";

const capabilities = [
  "Сбор новостей",
  "LLM-анализ",
  "События",
  "Нарративы",
  "3D-графы",
  "Профили источников"
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>локальная аналитическая платформа</p>
          <h1>Narrative Intelligence</h1>
          <p>
            Спокойный command center для анализа политических новостей: источники,
            события, участники, фрейминг, нарративы и доказательные цитаты в одном месте.
          </p>
          <nav className={styles.actions} aria-label="Основные разделы">
            <Link className={styles.primary} href="/articles">Открыть статьи</Link>
            <Link href="/narratives">Нарративы</Link>
          </nav>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Local stack</span>
            <strong>без платных API</strong>
          </div>
          <div className={styles.signal}>
            <i />
            <i />
            <i />
          </div>
          <ul>
            {capabilities.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
