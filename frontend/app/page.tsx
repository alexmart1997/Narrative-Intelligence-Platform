import styles from "./page.module.css";

const stack = ["FastAPI", "Next.js", "PostgreSQL", "Qdrant", "Ollama"];

export default function Home() {
  return (
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="page-title">
        <p className={styles.label}>Локальный прототип</p>
        <h1 id="page-title" className={styles.title}>
          Narrative Intelligence
        </h1>
        <p className={styles.description}>
          Платформа для сбора, анализа и интерпретации нарративов без платных
          API: все ключевые сервисы запускаются локально на вашем MacBook.
        </p>
        <ul className={styles.stack} aria-label="Технологический стек">
          {stack.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
