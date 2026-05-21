from __future__ import annotations

import re
from datetime import date, datetime

from bs4 import BeautifulSoup

from app.ingestion.base import MaterialType, NewsSourceAdapter, ParsedArticle


class CnnAdapter(NewsSourceAdapter):
    """Адаптер CNN: politics, world, us, analysis и opinion."""

    code = "cnn"
    name = "CNN"
    base_url = "https://edition.cnn.com"
    language = "en"
    country = "United States"
    section_urls = (
        "https://edition.cnn.com/politics",
        "https://edition.cnn.com/world",
        "https://edition.cnn.com/us",
        "https://edition.cnn.com/opinions",
        "https://edition.cnn.com/analysis",
    )

    def fetch_article_links(self, date_from: date, date_to: date, limit: int) -> list[str]:
        links: list[str] = []
        for section_url in self.section_urls:
            try:
                soup = self.get_soup(section_url)
                links.extend(self._extract_links(soup))
            except Exception:
                # Если один раздел временно недоступен, продолжаем собирать остальные.
                continue
            finally:
                self.pause()
        return self.deduplicate_links(links, limit)

    def parse_article(self, url: str) -> ParsedArticle:
        soup = self.get_soup(url)
        title = self._title(soup)
        published_at = self._published_at(soup)
        text = self._text(soup)
        section = self._section(soup, url)
        author = self._author(soup)
        material_type = self._material_type(soup, url)

        if not title:
            raise ValueError("Could not parse title")
        if not published_at:
            raise ValueError("Could not parse published date")
        if not text:
            text = title

        return ParsedArticle(
            source_name=self.name,
            source_url=self.base_url,
            title=title,
            url=url,
            published_at=published_at,
            text=text,
            language=self.language,
            section=section,
            author=author,
            material_type=material_type,
        )

    def _extract_links(self, soup: BeautifulSoup) -> list[str]:
        result: list[str] = []
        for tag in soup.find_all("a", href=True):
            href = self.absolute_url(str(tag["href"]))
            if not href.startswith("https://edition.cnn.com/"):
                continue
            if not re.search(r"/20\d{2}/\d{2}/\d{2}/", href):
                continue
            if "/videos/" in href or "/video/" in href or "/audio/" in href or "/gallery/" in href:
                continue
            if any(part in href for part in ("/politics/", "/world/", "/us/", "/opinions/", "/analysis/")):
                result.append(href)
        return result

    def _title(self, soup: BeautifulSoup) -> str:
        title = self.meta_content(soup, "og:title") or self.clean_text(soup.find("h1").get_text(" ") if soup.find("h1") else "")
        return self.clean_text(title)

    def _published_at(self, soup: BeautifulSoup) -> datetime | None:
        for item in self.json_ld_items(soup):
            value = item.get("datePublished") or item.get("dateCreated")
            parsed = self.parse_datetime(str(value) if value else None)
            if parsed:
                return parsed
        return self.parse_datetime(
            self.meta_content(soup, "article:published_time", "pubdate", "lastmod", "date")
        )

    def _text(self, soup: BeautifulSoup) -> str:
        selectors = (
            ".article__content p",
            ".article__main p",
            ".paragraph",
            "article p",
            "main p",
        )
        paragraphs: list[str] = []
        for selector in selectors:
            paragraphs = [self.clean_text(node.get_text(" ")) for node in soup.select(selector)]
            paragraphs = [item for item in paragraphs if item]
            if paragraphs:
                break
        preview = self.meta_content(soup, "og:description", "description")
        if preview:
            paragraphs.insert(0, self.clean_text(preview))
        return "\n\n".join(dict.fromkeys(paragraphs))

    def _section(self, soup: BeautifulSoup, url: str) -> str | None:
        section = self.meta_content(soup, "article:section", "section")
        if section:
            return self.clean_text(section)
        if "/politics/" in url:
            return "politics"
        if "/world/" in url:
            return "world"
        if "/us/" in url:
            return "us"
        if "/opinions/" in url:
            return "opinion"
        if "/analysis/" in url:
            return "analysis"
        return None

    def _author(self, soup: BeautifulSoup) -> str | None:
        for item in self.json_ld_items(soup):
            author = item.get("author")
            if isinstance(author, dict) and author.get("name"):
                return self.clean_text(str(author["name"]))
            if isinstance(author, list):
                names = [self.clean_text(str(node.get("name"))) for node in author if isinstance(node, dict)]
                names = [name for name in names if name]
                if names:
                    return ", ".join(names)
        return self.meta_content(soup, "author")

    def _material_type(self, soup: BeautifulSoup, url: str) -> MaterialType:
        text = f"{self.meta_content(soup, 'og:title') or ''} {url}".lower()
        if "interview" in text:
            return MaterialType.interview
        if "opinion" in text or "opinions" in text or "column" in text:
            return MaterialType.opinion
        if "analysis" in text:
            return MaterialType.analytics
        return MaterialType.article
