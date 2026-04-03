"""
Entity Discovery Backend with Brave Search and Groq
Pipeline:
  1. Parse query into components (location, venue type, item of interest)
  2. Run 3 targeted Brave searches to discover entities and attributes
  3. Feed all search results to Groq LLM for structured extraction
  4. Return clean JSON with source tracing per entity
"""

import os
import json
import hashlib
import httpx
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(
    title="Entity Discovery API",
    description="Brave Search + Groq pipeline for structured entity extraction",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
BRAVE_API_KEY = os.environ["BRAVE_API_KEY"]
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

# Simple in-memory cache
_cache: dict[str, tuple[list, datetime]] = {}
CACHE_TTL_HOURS = 6


# Cache helpers 

def cache_key(query: str) -> str:
    return hashlib.md5(query.lower().strip().encode()).hexdigest()

def get_cached(query: str) -> Optional[list]:
    key = cache_key(query)
    if key in _cache:
        results, cached_at = _cache[key]
        if datetime.now() - cached_at < timedelta(hours=CACHE_TTL_HOURS):
            return results
        del _cache[key]
    return None

def set_cache(query: str, results: list):
    _cache[cache_key(query)] = (results, datetime.now())


# Brave Search

async def brave_search(query: str, count: int = 10) -> list[dict]:
    """
    Run a single Brave search and return a list of result dicts with:
    title, url, description (snippet)
    """
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
    }
    params = {"q": query, "count": count, "search_lang": "en"}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(BRAVE_SEARCH_URL, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("web", {}).get("results", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        })
    return results


def build_search_queries(user_query: str) -> list[str]:
    """
    Build 3 targeted search queries from the user query.
    We ask Groq to decompose the query, then run all 3 searches.
    Falls back to simple heuristics if Groq fails.
    """
    prompt = f"""Given this user query: "{user_query}"

Generate exactly 3 web search queries to find:
1. A list/ranking of the top venues (e.g. "best cafes Brooklyn")
2. Specific items/attributes at those venues (e.g. "Brooklyn cafe signature drinks what to order")
3. Reviews or editorial coverage (e.g. "best Brooklyn coffee shops Eater Infatuation")

Return ONLY a JSON array of 3 strings. No explanation. Example:
["best cafes Brooklyn NY", "Brooklyn coffee shop signature drinks what to order", "best Brooklyn coffee shops eater infatuation review"]"""

    try:
        resp = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.2,
        )
        text = resp.choices[0].message.content.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        queries = json.loads(text)
        if isinstance(queries, list) and len(queries) >= 3:
            return queries[:3]
    except Exception:
        pass

    # Fallback
    return [
        user_query,
        user_query + " what to order signature",
        user_query + " review best picks",
    ]


def format_search_results(all_results: list[tuple[str, list[dict]]]) -> str:
    """
    Format all search results into a single text block for the LLM.
    """
    lines = []
    for query, results in all_results:
        lines.append(f"\n=== Search: {query} ===")
        for i, r in enumerate(results, 1):
            lines.append(f"\n[{i}] {r['title']}")
            lines.append(f"URL: {r['url']}")
            lines.append(f"Snippet: {r['snippet']}")
    return "\n".join(lines)


EXTRACTION_SYSTEM_PROMPT = """You are an entity extraction expert. You receive raw web search results and extract structured entity data from them.

For cafe/coffee queries, extract cafes as entities. Each entity must have:
- cafe_name: exact name as it appears in sources
- neighborhood: neighborhood and/or city
- website: official website URL if mentioned, else null
- signature_drink: the best/most notable specific drink to order (not generic like "coffee")
- drink_type: one of: espresso, latte, pour over, cold brew, cortado, cappuccino, drip, other
- price_range: "$", "$$", or "$$$" based on context clues
- why_known: 1-2 sentences grounded in what the sources actually say
- source_url: the URL this entity was primarily found at
- source_snippet: a brief paraphrase (max 25 words) of what the source says about this cafe/drink
- confidence: "high" if mentioned in 2+ results, "medium" if mentioned once with detail, "low" if vague

STRICT RULES:
- Only extract entities that actually appear in the search results
- Never invent or hallucinate cafe names, drinks, or URLs
- source_url must be a real URL from the results
- Aim for 8-12 entities with variety in neighborhoods, drink types, price ranges
- If a field cannot be determined from the results, use null
- Return ONLY a valid JSON array. No markdown, no explanation, no preamble."""


async def extract_entities(user_query: str, search_context: str) -> list[dict]:
    """
    Feed all search results to Groq and extract structured entities.
    """
    user_message = f"""User query: "{user_query}"

Here are the web search results:
{search_context}

Extract all cafe entities from these results and return a JSON array.
Only extract what is actually in the results above. Return ONLY the JSON array."""

    resp = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        max_tokens=4000,
        temperature=0.1,
    )

    text = resp.choices[0].message.content.strip()
    text = text.replace("```json", "").replace("```", "").strip()

    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON array in Groq response: {text[:300]}")

    return json.loads(text[start:end])


def normalize_entity(e: dict) -> dict:
    fields = [
        "cafe_name", "neighborhood", "website", "signature_drink",
        "drink_type", "price_range", "why_known", "source_url",
        "source_snippet", "confidence",
    ]
    return {f: e.get(f) for f in fields}


# API endpoints

class QueryRequest(BaseModel):
    query: str
    use_cache: bool = True


class DiscoveryResponse(BaseModel):
    query: str
    entities: list[dict]
    cached: bool
    search_queries: list[str]
    search_count: int
    latency_ms: int


@app.get("/")
def root():
    return {"service": "Entity Discovery API", "version": "2.0.0", "stack": "Brave Search + Groq"}


@app.get("/health")
def health():
    return {"status": "ok", "cache_entries": len(_cache)}


@app.post("/discover", response_model=DiscoveryResponse)
async def discover(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    start = datetime.now()

    if req.use_cache:
        cached = get_cached(req.query)
        if cached:
            return DiscoveryResponse(
                query=req.query,
                entities=cached,
                cached=True,
                search_queries=[],
                search_count=0,
                latency_ms=int((datetime.now() - start).total_seconds() * 1000),
            )

    try:
        search_queries = build_search_queries(req.query)

        all_results = []
        for q in search_queries:
            results = await brave_search(q, count=8)
            all_results.append((q, results))

        search_context = format_search_results(all_results)
        entities = await extract_entities(req.query, search_context)
        entities = [normalize_entity(e) for e in entities if isinstance(e, dict)]

        set_cache(req.query, entities)

        return DiscoveryResponse(
            query=req.query,
            entities=entities,
            cached=False,
            search_queries=search_queries,
            search_count=len(search_queries),
            latency_ms=int((datetime.now() - start).total_seconds() * 1000),
        )

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Brave Search error: {e.response.status_code} {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/cache/clear")
def clear_cache():
    _cache.clear()
    return {"message": "Cache cleared"}


@app.get("/cache/stats")
def cache_stats():
    now = datetime.now()
    return {
        "total": len(_cache),
        "entries": [
            {
                "key": k[:8] + "...",
                "entity_count": len(v[0]),
                "age_minutes": int((now - v[1]).total_seconds() / 60),
            }
            for k, v in _cache.items()
        ],
    }
