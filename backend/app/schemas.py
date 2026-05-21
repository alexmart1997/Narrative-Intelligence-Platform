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
