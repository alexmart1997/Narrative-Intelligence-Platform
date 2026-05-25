from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class SourceInfo(BaseModel):
    code: str
    name: str
    base_url: str
    language: str


class IngestSourcePeriodRequest(BaseModel):
    source_code: str = Field(..., examples=["rbc"])
    date_from: date
    date_to: date
    limit: int = Field(default=500, ge=1, le=1000)


class IngestError(BaseModel):
    url: str
    error: str


class IngestSourcePeriodResponse(BaseModel):
    source_code: str
    date_from: date
    date_to: date
    found_links: int
    parsed_articles: int
    saved_articles: int
    duplicates: int
    errors: list[IngestError]


class ArticleListItem(BaseModel):
    id: int
    source_code: Optional[str]
    source_name: str
    title: str
    url: str
    published_at: datetime
    language: str
    section: Optional[str]
    author: Optional[str]
    material_type: str
    text_preview: str
    has_analysis: bool
    has_event: bool
    event_id: Optional[int] = None


class ArticleListResponse(BaseModel):
    items: list[ArticleListItem]
    count: int


class LlmTestRequest(BaseModel):
    prompt: str = Field(..., min_length=1, examples=["Кратко объясни, что такое фрейминг в политических новостях."])


class LlmTestResponse(BaseModel):
    model: str
    response: str


class AnalysisEntityItem(BaseModel):
    id: int
    name: str
    type: str
    role: Optional[str]
    importance_score: Optional[float]


class AnalysisRelationItem(BaseModel):
    id: int
    source: str
    target: str
    relation_type: str
    description: str
    confidence: float


class AnalysisEvidenceItem(BaseModel):
    id: int
    article_id: int
    analysis_id: Optional[int]
    evidence_type: str
    target: str
    quote: str
    explanation: str
    confidence: float
    created_at: datetime


class ArticleAnalysisResponse(BaseModel):
    id: int
    article_id: int
    short_summary: str
    detailed_summary: str
    sentiment: str
    stance: str
    framing: str
    sympathizes_with: list[str]
    criticizes: list[str]
    narrative_hypothesis: str
    confidence: float
    entities: list[AnalysisEntityItem]
    relations: list[AnalysisRelationItem]
    evidence: dict[str, list[AnalysisEvidenceItem]]


class ArticleEmbedResponse(BaseModel):
    article_id: int
    collection: str
    vector_size: int


class EmbedAllResponse(BaseModel):
    total: int
    embedded: int
    errors: int


class SimilarArticleItem(BaseModel):
    score: float
    article_id: Optional[int]
    title: str
    source_name: str
    published_at: str
    language: str


class SimilarArticlesResponse(BaseModel):
    article_id: int
    items: list[SimilarArticleItem]


class CompareArticlesRequest(BaseModel):
    article_id_1: int
    article_id_2: int


class ArticleComparisonResult(BaseModel):
    same_event_probability: float
    fact_overlap: float
    main_common_facts: list[str]
    differences: list[str]
    source_1_framing: str
    source_2_framing: str
    source_1_sympathy: str
    source_2_sympathy: str
    source_1_criticism: str
    source_2_criticism: str
    narrative_difference: str
    conclusion: str


class CompareWithSimilarItem(BaseModel):
    article_id: int
    similarity_score: float
    comparison: ArticleComparisonResult


class CompareWithSimilarResponse(BaseModel):
    article_id: int
    items: list[CompareWithSimilarItem]


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    data: dict


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    data: dict


class ArticleGraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class NarrativeDiscoveryResponse(BaseModel):
    total_analyses: int
    clusters: int
    created_narratives: int


class NarrativeEvidenceItem(BaseModel):
    article_id: int
    article_title: str
    source_name: str
    evidence_text: str
    confidence: float


class NarrativeListItem(BaseModel):
    id: int
    title: str
    description: str
    frame: str
    evidence_count: int
    created_at: datetime


class NarrativeDetailResponse(BaseModel):
    id: int
    title: str
    description: str
    frame: str
    created_at: datetime
    evidence: list[NarrativeEvidenceItem]


class EventDetectionResponse(BaseModel):
    event_id: int
    title: str
    article_id: int


class EventDetectAllResponse(BaseModel):
    total: int
    detected: int
    errors: int


class EventArticleItem(BaseModel):
    article_id: int
    article_title: str
    source_name: str
    same_event_probability: float
    evidence_text: Optional[str]
    published_at: datetime


class EventEntityItem(BaseModel):
    entity_id: int
    name: str
    type: str
    role: Optional[str]
    importance_score: Optional[float]


class EventListItem(BaseModel):
    id: int
    title: str
    description: str
    event_date: Optional[datetime]
    event_type: Optional[str]
    location: Optional[str]
    article_count: int
    created_at: datetime


class EventDetailResponse(BaseModel):
    id: int
    title: str
    description: str
    event_date: Optional[datetime]
    event_type: Optional[str]
    location: Optional[str]
    created_at: datetime
    articles: list[EventArticleItem]
    entities: list[EventEntityItem]


class PipelineProcessRequest(BaseModel):
    source_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    language: Optional[str] = None
    only_without_analysis: bool = True
    limit: int = Field(default=100, ge=1, le=500)
    steps: list[str] = Field(default_factory=lambda: ["analyze", "embed", "detect_event"])


class PipelineStepStats(BaseModel):
    success: int = 0
    failed: int = 0
    skipped: int = 0


class PipelineErrorItem(BaseModel):
    article_id: int
    step: str
    error: str


class PipelineProcessResponse(BaseModel):
    selected_articles: int
    processed: int
    failed: int
    steps: dict[str, PipelineStepStats]
    errors: list[PipelineErrorItem]


class PipelineRunResponse(BaseModel):
    id: int
    started_at: datetime
    finished_at: Optional[datetime]
    status: str
    selected_articles: int
    processed: int
    failed: int
    params: dict
    result: Optional[PipelineProcessResponse]


class JobAnalyzeRequest(BaseModel):
    article_id: int = Field(..., ge=1)
    include_compare: bool = False


class JobPipelineRequest(BaseModel):
    source_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    language: Optional[str] = None
    only_without_analysis: bool = False
    only_with_analysis: bool = False
    limit: int = Field(default=100, ge=1, le=500)
    steps: list[str] = Field(default_factory=lambda: ["analyze", "embed", "similar", "graph_precompute"])


class JobResponse(BaseModel):
    id: int
    type: str
    status: str
    progress: float
    params: dict
    result: Optional[dict]
    logs: list[dict]
    error: Optional[str]
    retry_count: int
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]


class PrecomputeRequest(BaseModel):
    source_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    language: Optional[str] = None
    only_with_analysis: bool = True
    limit: int = Field(default=100, ge=1, le=500)
    limit_related: int = Field(default=30, ge=1, le=50)
    similar_limit: int = Field(default=10, ge=1, le=50)
    include_compare: bool = False


class PrecomputeResponse(BaseModel):
    selected_articles: int
    processed: int
    failed: int
    cached_graphs: int
    cached_similar: int
    cached_comparisons: int
    errors: list[dict]


class SourceProfileSource(BaseModel):
    id: int
    code: Optional[str]
    name: str
    url: str
    country: str
    political_orientation: Optional[str]


class SourceProfilePeriod(BaseModel):
    date_from: Optional[date]
    date_to: Optional[date]
    language: Optional[str]


class SourceEntityStat(BaseModel):
    name: str
    type: str
    count: int


class SourceNarrativeStat(BaseModel):
    title: str
    count: int


class SourceNarrativeHypothesisStat(BaseModel):
    text: str
    count: int


class SourceFramingStat(BaseModel):
    framing: str
    count: int


class SourceTargetStat(BaseModel):
    target: str
    count: int


class SourceProfileResponse(BaseModel):
    source: SourceProfileSource
    period: SourceProfilePeriod
    articles_count: int
    top_entities: list[SourceEntityStat]
    top_narratives: list[SourceNarrativeStat]
    top_narrative_hypotheses: list[SourceNarrativeHypothesisStat]
    sentiment_distribution: dict[str, int]
    top_framings: list[SourceFramingStat]
    sympathizes_with_top: list[SourceTargetStat]
    criticizes_top: list[SourceTargetStat]
