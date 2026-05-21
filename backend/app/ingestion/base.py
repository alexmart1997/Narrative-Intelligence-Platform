from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup


class MaterialType(str, Enum):
    """Тип материала, который удалось определить при парсинге."""

    news = "news"
    article = "article"
    analytics = "analytics"
    opinion = "opinion"
    interview = "interview"
    unknown = "unknown"


@dataclass(frozen=True)
class ParsedArticle:
    """Нормализованная статья, которую дальше можно сохранить в БД."""

    source_name: str
    source_url: str
    title: str
    url: str
    published_at: datetime
    text: str
    language: str
    section: str | None = None
    author: str | None = None
    material_type: MaterialType = MaterialType.unknown


class NewsSourceAdapter(ABC):
    """Базовый адаптер источника новостей."""

    code: str
    name: str
    base_url: str
    language: str
    country: str
    section_urls: tuple[str, ...]
    request_pause_seconds: float = 0.8
    timeout_seconds: float = 15.0

    def __init__(self) -> None:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.9",
        }
        self.client = httpx.Client(headers=headers, timeout=self.timeout_seconds, follow_redirects=True)

    @abstractmethod
    def fetch_article_links(self, date_from: date, date_to: date, limit: int) -> list[str]:
        """Возвращает ссылки на потенциальные материалы за период."""

    @abstractmethod
    def parse_article(self, url: str) -> ParsedArticle:
        """Парсит одну публикацию."""

    def fetch_articles(self, date_from: date, date_to: date, limit: int) -> list[ParsedArticle]:
        """Загружает и фильтрует статьи по дате публикации."""

        articles: list[ParsedArticle] = []
        for url in self.fetch_article_links(date_from, date_to, limit):
            article = self.parse_article(url)
            if date_from <= article.published_at.date() <= date_to:
                articles.append(article)
            if len(articles) >= limit:
                break
            self.pause()
        return articles

    def get_soup(self, url: str) -> BeautifulSoup:
        """Загружает HTML-страницу и возвращает BeautifulSoup."""

        response = self.client.get(url)
        response.raise_for_status()
        return BeautifulSoup(response.text, "lxml")

    def pause(self) -> None:
        """Небольшая пауза между запросами, чтобы не спамить сайты."""

        time.sleep(self.request_pause_seconds)

    def absolute_url(self, url: str) -> str:
        """Превращает относительную ссылку в абсолютную."""

        return urljoin(self.base_url, url)

    @staticmethod
    def clean_text(value: str | None) -> str:
        """Убирает лишние пробелы и переносы строк."""

        if not value:
            return ""
        return " ".join(value.split())

    @staticmethod
    def meta_content(soup: BeautifulSoup, *names: str) -> str | None:
        """Достает content из meta по name/property."""

        for name in names:
            tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
            if tag and tag.get("content"):
                return str(tag["content"])
        return None

    @staticmethod
    def json_ld_items(soup: BeautifulSoup) -> list[dict[str, Any]]:
        """Возвращает JSON-LD объекты страницы, если они есть."""

        import json

        items: list[dict[str, Any]] = []
        for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
            if not script.string:
                continue
            try:
                data = json.loads(script.string)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                graph = data.get("@graph")
                if isinstance(graph, list):
                    items.extend(item for item in graph if isinstance(item, dict))
                else:
                    items.append(data)
            elif isinstance(data, list):
                items.extend(item for item in data if isinstance(item, dict))
        return items

    @staticmethod
    def parse_datetime(value: str | None) -> datetime | None:
        """Пробует разобрать дату из ISO-строки."""

        if not value:
            return None
        normalized = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None

    @staticmethod
    def deduplicate_links(links: list[str], limit: int) -> list[str]:
        """Сохраняет порядок ссылок и убирает дубли."""

        seen: set[str] = set()
        result: list[str] = []
        for link in links:
            normalized = link.split("#")[0]
            if normalized in seen:
                continue
            seen.add(normalized)
            result.append(normalized)
            if len(result) >= limit:
                break
        return result
