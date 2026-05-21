const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ArticleListItem = {
  id: number;
  source_code: string | null;
  source_name: string;
  title: string;
  url: string;
  published_at: string;
  language: string;
  section: string | null;
  author: string | null;
  material_type: string;
  text_preview: string;
};

export type ArticleListResponse = {
  items: ArticleListItem[];
  count: number;
};

export type SourceInfo = {
  code: string;
  name: string;
  base_url: string;
  language: string;
};

export type SimilarArticleItem = {
  score: number;
  article_id: number | null;
  title: string;
  source_name: string;
  published_at: string;
  language: string;
};

export type SimilarArticlesResponse = {
  article_id: number;
  items: SimilarArticleItem[];
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  data: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: Record<string, unknown>;
};

export type ArticleGraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type ArticleFilters = {
  sourceCode?: string;
  language?: string;
  q?: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getSources(): Promise<SourceInfo[]> {
  return request<SourceInfo[]>("/ingest/sources");
}

export async function getArticles(filters: ArticleFilters): Promise<ArticleListResponse> {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (filters.sourceCode) {
    params.set("source_code", filters.sourceCode);
  }
  if (filters.language) {
    params.set("language", filters.language);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  return request<ArticleListResponse>(`/articles?${params.toString()}`);
}

export async function analyzeArticle(articleId: number): Promise<void> {
  await request(`/articles/${articleId}/analyze`, { method: "POST" });
}

export async function getArticleGraph(articleId: number): Promise<ArticleGraphResponse> {
  return request<ArticleGraphResponse>(`/graph/article/${articleId}`);
}

export async function getSimilarArticles(articleId: number): Promise<SimilarArticlesResponse> {
  return request<SimilarArticlesResponse>(`/articles/${articleId}/similar?limit=10`);
}
