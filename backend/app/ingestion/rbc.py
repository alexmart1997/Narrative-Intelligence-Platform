from __future__ import annotations

from datetime import date, datetime

from bs4 import BeautifulSoup

from app.ingestion.base import MaterialType, NewsSourceAdapter, ParsedArticle


class RbcAdapter(NewsSourceAdapter):
    """Адаптер РБК: новости, политика, экономика и общество."""

    code = "rbc"
    name = "РБК"
    base_url = "https://www.rbc.ru"
    language = "ru"
    country = "Russia"
    section_urls = (
        "https://www.rbc.ru",
        "https://www.rbc.ru/politics/",
        "https://www.rbc.ru/economics/",
        "https://www.rbc.ru/society/",
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
            raise ValueError("Не удалось получить заголовок")
        if not published_at:
            raise ValueError("Не удалось получить дату публикации")
        if not text:
            # Для MVP сохраняем хотя бы заголовок, если полный текст закрыт или изменился HTML.
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
            if "rbc.ru" not in href:
                continue
            if any(part in href for part in ("/politics/", "/economics/", "/society/")):
                result.append(href)
            elif "/rbcfreenews/" in href or "/short_news/" in href:
                result.append(href)
        return result

    def _title(self, soup: BeautifulSoup) -> str:
        value = self.meta_content(soup, "og:title") or self.clean_text(soup.find("h1").get_text(" ") if soup.find("h1") else "")
        return self.clean_text(value)

    def _published_at(self, soup: BeautifulSoup) -> datetime | None:
        for item in self.json_ld_items(soup):
            value = item.get("datePublished") or item.get("dateCreated")
            parsed = self.parse_datetime(str(value) if value else None)
            if parsed:
                return parsed
        return self.parse_datetime(self.meta_content(soup, "article:published_time", "mediator_published_time"))

    def _text(self, soup: BeautifulSoup) -> str:
        selectors = (
            ".article__text p",
            ".article__text__overview",
            ".article__text",
            "[itemprop='articleBody'] p",
            ".news-detail__text p",
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
        section = self.meta_content(soup, "article:section")
        if section:
            return self.clean_text(section)
        if "/politics/" in url:
            return "politics"
        if "/economics/" in url:
            return "economics"
        if "/society/" in url:
            return "society"
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
        text = " ".join(
            filter(
                None,
                [
                    self.meta_content(soup, "article:section"),
                    self.meta_content(soup, "og:title"),
                    url,
                ],
            )
        ).lower()
        if "интервью" in text or "interview" in text:
            return MaterialType.interview
        if "мнение" in text or "opinion" in text or "колон" in text:
            return MaterialType.opinion
        if "аналит" in text or "разбор" in text:
            return MaterialType.analytics
        if "/rbcfreenews/" in url or "/short_news/" in url:
            return MaterialType.news
        return MaterialType.article
