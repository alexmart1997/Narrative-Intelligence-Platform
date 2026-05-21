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
