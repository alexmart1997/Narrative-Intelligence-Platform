import httpx

from app.config import settings


class LlmError(Exception):
    """Ошибка обращения к локальной LLM."""


def call_llm(prompt: str) -> str:
    """Отправляет prompt в локальный Ollama API и возвращает текст ответа модели."""

    url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    payload = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False,
    }

    try:
        response = httpx.post(url, json=payload, timeout=120.0)
        response.raise_for_status()
    except httpx.ConnectError as exc:
        raise LlmError("Ollama не запущен или недоступен по адресу из OLLAMA_BASE_URL") from exc
    except httpx.TimeoutException as exc:
        raise LlmError("Ollama не ответил за отведенное время") from exc
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500]
        raise LlmError(f"Ollama вернул ошибку {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise LlmError(f"Ошибка HTTP при обращении к Ollama: {exc}") from exc

    data = response.json()
    answer = data.get("response")
    if not isinstance(answer, str):
        raise LlmError("Ollama вернул ответ в неожиданном формате")
    return answer
