from fastapi import HTTPException

from app.comparison import ComparisonError
from app.events import EventDetectionError
from app.narratives import NarrativeDiscoveryError
from app.vector import VectorError


def vector_http_error(exc: VectorError) -> HTTPException:
    message = str(exc)
    if message == "Статья не найдена":
        return HTTPException(status_code=404, detail=message)
    if "Сначала нужно выполнить" in message:
        return HTTPException(status_code=400, detail=message)
    return HTTPException(status_code=503, detail=message)


def comparison_http_error(exc: ComparisonError) -> HTTPException:
    message = str(exc)
    if "не найдена" in message:
        return HTTPException(status_code=404, detail=message)
    if "сначала нужно выполнить" in message:
        return HTTPException(status_code=400, detail=message)
    if "Ollama" in message or "Qdrant" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)


def narrative_http_error(exc: NarrativeDiscoveryError) -> HTTPException:
    message = str(exc)
    if "не найден" in message:
        return HTTPException(status_code=404, detail=message)
    if "Ollama" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)


def event_http_error(exc: EventDetectionError) -> HTTPException:
    message = str(exc)
    if "не найден" in message:
        return HTTPException(status_code=404, detail=message)
    if "Сначала нужно" in message:
        return HTTPException(status_code=400, detail=message)
    if "Ollama" in message or "Qdrant" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)
