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
  has_analysis: boolean;
  has_event: boolean;
  event_id: number | null;
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
  similarity_score: number;
  embedding_similarity: number;
  same_story_probability: number;
  shared_entities: string[];
  shared_keywords: string[];
  similarity_reason: string;
  classification: "same_story" | "related_context" | "not_related";
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

export type AnalysisEntityItem = {
  id: number;
  name: string;
  type: string;
  role: string | null;
  importance_score: number | null;
};

export type AnalysisRelationItem = {
  id: number;
  source: string;
  target: string;
  relation_type: string;
  description: string;
  confidence: number;
};

export type AnalysisEvidenceItem = {
  id: number;
  article_id: number;
  analysis_id: number | null;
  evidence_type: string;
  target: string;
  quote: string;
  explanation: string;
  confidence: number;
  created_at: string;
};

export type ArticleAnalysisResponse = {
  id: number;
  article_id: number;
  short_summary: string;
  detailed_summary: string;
  sentiment: string;
  stance: string;
  framing: string;
  sympathizes_with: string[];
  criticizes: string[];
  narrative_hypothesis: string;
  confidence: number;
  entities: AnalysisEntityItem[];
  relations: AnalysisRelationItem[];
  evidence: Record<string, AnalysisEvidenceItem[]>;
};

export type ArticleComparisonResult = {
  same_event_probability: number;
  fact_overlap: number;
  main_common_facts: string[];
  differences: string[];
  source_1_framing: string;
  source_2_framing: string;
  source_1_sympathy: string;
  source_2_sympathy: string;
  source_1_criticism: string;
  source_2_criticism: string;
  narrative_difference: string;
  conclusion: string;
};

export type CompareWithSimilarItem = {
  article_id: number;
  similarity_score: number;
  comparison: ArticleComparisonResult;
};

export type CompareWithSimilarResponse = {
  article_id: number;
  items: CompareWithSimilarItem[];
};

export type NarrativeListItem = {
  id: number;
  title: string;
  description: string;
  frame: string;
  evidence_count: number;
  created_at: string;
};

export type NarrativeEvidenceItem = {
  article_id: number;
  article_title: string;
  source_name: string;
  evidence_text: string;
  confidence: number;
};

export type NarrativeDetailResponse = Omit<NarrativeListItem, "evidence_count"> & {
  evidence: NarrativeEvidenceItem[];
};

export type EventDetailResponse = {
  id: number;
  title: string;
  description: string;
  event_date: string | null;
  event_type: string | null;
  location: string | null;
  created_at: string;
  articles: Array<{
    article_id: number;
    article_title: string;
    source_name: string;
    same_event_probability: number;
    evidence_text: string | null;
    published_at: string;
  }>;
  entities: Array<{
    entity_id: number;
    name: string;
    type: string;
    role: string | null;
    importance_score: number | null;
  }>;
};

export type NarrativeDiscoveryResponse = {
  total_analyses: number;
  clusters: number;
  created_narratives: number;
};

export type PrecomputeResponse = {
  selected_articles: number;
  processed: number;
  failed: number;
  cached_graphs: number;
  cached_similar: number;
  cached_comparisons: number;
  errors: Array<{ article_id?: number; error: string }>;
};

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type JobResponse = {
  id: number;
  type: string;
  status: JobStatus;
  progress: number;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  logs: Array<{ ts?: string; message?: string }>;
  error: string | null;
  retry_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type SourceProfileResponse = {
  source: {
    id: number;
    code: string | null;
    name: string;
    url: string;
    country: string;
    political_orientation: string | null;
  };
  period: {
    date_from: string | null;
    date_to: string | null;
    language: string | null;
  };
  articles_count: number;
  top_entities: Array<{ name: string; type: string; count: number }>;
  top_narratives: Array<{ title: string; count: number }>;
  top_narrative_hypotheses: Array<{ text: string; count: number }>;
  sentiment_distribution: Record<"positive" | "negative" | "neutral" | "mixed", number>;
  top_framings: Array<{ framing: string; count: number }>;
  sympathizes_with_top: Array<{ target: string; count: number }>;
  criticizes_top: Array<{ target: string; count: number }>;
};

type ArticleFilters = {
  sourceCode?: string;
  language?: string;
  q?: string;
  entityId?: string;
  entityName?: string;
  dateFrom?: string;
  dateTo?: string;
  materialType?: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18000);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: options?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractErrorMessage(errorText) || `Запрос завершился ошибкой ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function extractErrorMessage(errorText: string) {
  if (!errorText) return "";
  try {
    const data = JSON.parse(errorText) as { detail?: unknown };
    if (typeof data.detail === "string") return data.detail;
    return errorText;
  } catch {
    return errorText;
  }
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
  if (filters.entityId) {
    params.set("entity_id", filters.entityId);
  }
  if (filters.entityName) {
    params.set("entity_name", filters.entityName);
  }
  if (filters.dateFrom) {
    params.set("date_from", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("date_to", filters.dateTo);
  }
  if (filters.materialType) {
    params.set("material_type", filters.materialType);
  }
  return request<ArticleListResponse>(`/articles?${params.toString()}`);
}

export async function analyzeArticle(articleId: number): Promise<void> {
  await request(`/articles/${articleId}/analyze`, { method: "POST" });
}

export async function embedArticle(articleId: number): Promise<void> {
  await request(`/articles/${articleId}/embed`, { method: "POST" });
}

export async function detectArticleEvent(articleId: number): Promise<void> {
  await request(`/articles/${articleId}/detect-event`, { method: "POST" });
}

export async function getArticleAnalysis(articleId: number): Promise<ArticleAnalysisResponse> {
  return request<ArticleAnalysisResponse>(`/articles/${articleId}/analysis`);
}

export async function getArticleEvidence(articleId: number): Promise<Record<string, AnalysisEvidenceItem[]>> {
  return request<Record<string, AnalysisEvidenceItem[]>>(`/articles/${articleId}/evidence`);
}

export async function getArticleGraph(
  articleId: number,
  options: { includeRelated?: boolean; limitRelated?: number; focusEntityId?: number | null } = {}
): Promise<ArticleGraphResponse> {
  const params = new URLSearchParams();
  if (options.includeRelated) params.set("include_related", "true");
  if (options.limitRelated) params.set("limit_related", String(options.limitRelated));
  if (options.focusEntityId) params.set("focus_entity_id", String(options.focusEntityId));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<ArticleGraphResponse>(`/graph/article/${articleId}${suffix}`);
}

export async function getSimilarArticles(articleId: number): Promise<SimilarArticlesResponse> {
  return request<SimilarArticlesResponse>(`/articles/${articleId}/similar?limit=10&min_score=0.68`);
}

export async function compareWithSimilar(articleId: number): Promise<CompareWithSimilarResponse> {
  return request<CompareWithSimilarResponse>(`/articles/${articleId}/compare-with-similar`);
}

export async function getNarratives(): Promise<NarrativeListItem[]> {
  return request<NarrativeListItem[]>("/narratives");
}

export async function getNarrative(narrativeId: number): Promise<NarrativeDetailResponse> {
  return request<NarrativeDetailResponse>(`/narratives/${narrativeId}`);
}

export async function getNarrativeGraph(narrativeId: number): Promise<ArticleGraphResponse> {
  return request<ArticleGraphResponse>(`/graph/narrative/${narrativeId}`);
}

export async function discoverNarratives(): Promise<NarrativeDiscoveryResponse> {
  return request<NarrativeDiscoveryResponse>("/narratives/discover", { method: "POST" });
}

export async function startAnalyzeJob(articleId: number): Promise<JobResponse> {
  return request<JobResponse>("/jobs/analyze", {
    method: "POST",
    body: JSON.stringify({ article_id: articleId })
  });
}

export async function startPipelineJob(filters: {
  dateFrom?: string;
  dateTo?: string;
  sourceCode?: string;
  language?: string;
  limit?: number;
  steps?: string[];
  onlyWithoutAnalysis?: boolean;
  onlyWithAnalysis?: boolean;
} = {}): Promise<JobResponse> {
  return request<JobResponse>("/jobs/pipeline", {
    method: "POST",
    body: JSON.stringify({
      source_code: filters.sourceCode || null,
      date_from: filters.dateFrom || null,
      date_to: filters.dateTo || null,
      language: filters.language || null,
      only_without_analysis: filters.onlyWithoutAnalysis ?? false,
      only_with_analysis: filters.onlyWithAnalysis ?? false,
      limit: filters.limit ?? 100,
      steps: filters.steps ?? ["analyze", "embed", "similar", "graph_precompute"]
    })
  });
}

export async function getJobs(): Promise<JobResponse[]> {
  return request<JobResponse[]>("/jobs?limit=12");
}

export async function getJob(jobId: number): Promise<JobResponse> {
  return request<JobResponse>(`/jobs/${jobId}`);
}

export async function cancelJob(jobId: number): Promise<JobResponse> {
  return request<JobResponse>(`/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function precomputeIntelligence(filters: {
  dateFrom?: string;
  dateTo?: string;
  sourceCode?: string;
  language?: string;
  limit?: number;
} = {}): Promise<PrecomputeResponse> {
  return request<PrecomputeResponse>("/pipeline/precompute-intelligence", {
    method: "POST",
    body: JSON.stringify({
      source_code: filters.sourceCode || null,
      date_from: filters.dateFrom || null,
      date_to: filters.dateTo || null,
      language: filters.language || null,
      only_with_analysis: true,
      limit: filters.limit ?? 100,
      limit_related: 30,
      similar_limit: 10,
      include_compare: false
    })
  });
}

export async function getEvent(eventId: number): Promise<EventDetailResponse> {
  return request<EventDetailResponse>(`/events/${eventId}`);
}

export async function getSourceProfile(
  sourceCode: string,
  filters: { dateFrom?: string; dateTo?: string; language?: string } = {}
): Promise<SourceProfileResponse> {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.language) params.set("language", filters.language);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<SourceProfileResponse>(`/sources/${sourceCode}/profile${suffix}`);
}
