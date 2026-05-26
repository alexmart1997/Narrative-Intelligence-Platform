import Link from "next/link";
import styles from "./page.module.css";

const capabilities = [
  "Анализ статьи",
  "Похожие материалы",
  "Граф связей",
  "Сравнение освещения"
];

const signals = [
  { label: "Coverage", value: "Article Flow" },
  { label: "Similarity", value: "Story Match" },
  { label: "Narrative", value: "Frame Shift" }
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Political Media Intelligence</p>
          <h1>Narrative Intelligence</h1>
          <p>
            Платформа для анализа политических новостей: выделяет смысл,
            находит действительно похожие материалы, строит граф связей и
            показывает, как разные источники описывают один сюжет.
          </p>
          <nav className={styles.actions} aria-label="Основные разделы">
            <Link className={styles.primary} href="/articles">Открыть рабочее пространство</Link>
            <Link href="/map">Карта поля</Link>
          </nav>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Intelligence Console</span>
            <strong>active</strong>
          </div>
          <div className={styles.signal}>
            <i />
            <i />
            <i />
          </div>
          <div className={styles.signalGrid}>
            {signals.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <ul>
            {capabilities.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
