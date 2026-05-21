from __future__ import annotations

from datetime import date, datetime

from bs4 import BeautifulSoup

from app.ingestion.base import MaterialType, NewsSourceAdapter, ParsedArticle


class BbcAdapter(NewsSourceAdapter):
    """Адаптер BBC News: несколько международных и политических разделов."""

    code = "bbc"
    name = "BBC"
    base_url = "https://www.bbc.com/news"
    language = "en"
    country = "United Kingdom"
    section_urls = (
        "https://www.bbc.com/news/world",
        "https://www.bbc.com/news/world/europe",
        "https://www.bbc.com/news/us-canada",
        "https://www.bbc.com/news/politics",
        "https://www.bbc.com/news/topics/cx1m7zg0g4zt",
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
            if not href.startswith("https://www.bbc.com/news/"):
                continue
            if "/av/" in href or "/live/" in href:
                continue
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
        time_tag = soup.find("time")
        datetime_value = time_tag.get("datetime") if time_tag else None
        return self.parse_datetime(str(datetime_value) if datetime_value else None)

    def _text(self, soup: BeautifulSoup) -> str:
        paragraphs = [
            self.clean_text(node.get_text(" "))
            for node in soup.select("article p, main p, [data-component='text-block'] p")
        ]
        paragraphs = [item for item in paragraphs if item]
        preview = self.meta_content(soup, "og:description", "description")
        if preview:
            paragraphs.insert(0, self.clean_text(preview))
        return "\n\n".join(dict.fromkeys(paragraphs))

    def _section(self, soup: BeautifulSoup, url: str) -> str | None:
        section = self.meta_content(soup, "article:section")
        if section:
            return self.clean_text(section)
        if "/world/europe" in url:
            return "europe"
        if "/world" in url:
            return "world"
        if "/us-canada" in url:
            return "us-canada"
        if "/politics" in url:
            return "politics"
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
        if "opinion" in text or "column" in text:
            return MaterialType.opinion
        if "analysis" in text or "feature" in text:
            return MaterialType.analytics
        return MaterialType.article
