import Link from "next/link";
import styles from "./page.module.css";

const capabilities = [
  "Анализ статьи",
  "Похожие материалы",
  "Граф связей",
  "Сравнение освещения"
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>локальная аналитическая платформа</p>
          <h1>Narrative Intelligence</h1>
          <p>
            Локальный инструмент для точного анализа новостей: что произошло,
            как текст это подает, какие материалы действительно похожи и чем
            отличается освещение одного сюжета.
          </p>
          <nav className={styles.actions} aria-label="Основные разделы">
            <Link className={styles.primary} href="/articles">Articles</Link>
          </nav>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Focused MVP</span>
            <strong>локально</strong>
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
