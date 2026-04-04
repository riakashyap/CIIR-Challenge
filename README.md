# CIIR-Challenge
Multi-stage AI pipeline that discovers structured entity data from the web and can search, extract, and trace every result to its source.

# Entity Discovery System

A multi-stage AI pipeline that takes any natural language topic query and returns a structured table of discovered entities with source-traced attributes — powered by Brave Search and Groq.

**Live Demo**: https://ciir-challenge.vercel.app/

---

## What it does

Type any topic — "Top AI startups in healthcare", "Best pizza in Chicago", "Open source database tools" — and the system:

1. **Decomposes your query** into 3 targeted web searches using Groq LLM
2. **Searches the web** via Brave Search API (8 results per query)
3. **Scrapes the top pages** from each search for richer content
4. **Extracts structured entities** using Groq llama-3.3-70b, inferring the right schema from context
5. **Returns a table** with name, category, location, key attribute, description, source URL, and confidence score per entity
6. **Export** results as JSON or CSV

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Python |
| LLM | Groq (llama-3.3-70b-versatile) |
| Search | Brave Search API |
| Scraping | httpx + regex HTML stripping |
| Frontend | React + Vite |
| Backend hosting | Render |
| Frontend hosting | Vercel |

---

## Local Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- Brave Search API key — https://brave.com/search/api/ 
- Groq API key — https://console.groq.com/ 

### 1. Clone the repo

```bash
git clone https://github.com/riakashyap/CIIR-Challenge.git
cd CIIR-Challenge
```

### 2. Backend

```bash
cd backend
```

Create a `.env` file in the backend folder with your keys:

```
GROQ_API_KEY=your_groq_key_here
BRAVE_API_KEY=your_brave_key_here
```

Install dependencies and start the server:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend runs at http://localhost:8000
API docs at http://localhost:8000/docs

### 3. Frontend

```bash
cd frontend
```

Create a `.env` file in the frontend folder:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Frontend runs at http://localhost:5173

---

## Deployment

### Backend on Render

1. Create a new Web Service on Render pointing to your repo's backend/ directory
2. Set the start command to:

```
uvicorn main:app --host 0.0.0.0 --port $PORT
```

3. Add these environment variables in the Render dashboard:

```
GROQ_API_KEY=your_groq_key_here
BRAVE_API_KEY=your_brave_key_here
```

### Frontend on Vercel

1. Create a new project on Vercel pointing to your repo's frontend/ directory
2. Add this environment variable in the Vercel dashboard:

```
VITE_API_BASE_URL=https://your-backend.onrender.com
```

3. Set build command to: npm run build
4. Set output directory to: dist

---

## How the Pipeline Works

```
User query
    |
    v
Query decomposition (Groq)   ->  generates 3 targeted search queries
    |
    v
Brave Search x3 queries      ->  8 results per query, up to 24 total
    |
    v
Page scraping (top 2/query)  ->  strips HTML, extracts plain text
    |
    v
Entity extraction (Groq)     ->  single batched LLM call, infers schema
    |
    v
Structured JSON + cache      ->  normalized, source-traced, confidence scored
```

---

## Design Decisions

**Query decomposition**: Instead of one broad search, the LLM generates 3 targeted queries covering rankings, specific attributes, and editorial coverage. This surfaces more entity diversity and richer detail than a single search would.

**Scraping on top of snippets**: Brave search snippets are ~150 characters — not enough for accurate extraction. The pipeline fetches and strips the top 2 pages per query, giving the LLM substantially more content to work from.

**Single LLM extraction pass**: All search results are batched into one Groq call rather than per-URL calls. This is faster, cheaper, and lets the model cross-reference entities across multiple sources to assign confidence scores accurately.

**Generic schema**: The extraction prompt infers the entity type from the query rather than using hardcoded fields. The same pipeline works equally well for restaurants, startups, tools, people, or any other entity type.

**In-memory cache**: 6-hour TTL keyed by query hash. Eliminates redundant API calls for repeated queries within a session. Resets on server restart. Can be cleared via DELETE /cache/clear.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | /discover | Run the full pipeline for a query |
| GET | /health | Health check |
| GET | /cache/stats | View cache entries and ages |
| DELETE | /cache/clear | Clear all cached results |

### Example request

```bash
curl -X POST http://localhost:8000/discover \
  -H "Content-Type: application/json" \
  -d '{"query": "Top AI startups in healthcare", "use_cache": true}'
```

### Example response

```json
{
  "query": "Top AI startups in healthcare",
  "entities": [
    {
      "entity_name": "Tempus AI",
      "category": "startup",
      "location": "Chicago",
      "website": "https://tempus.com",
      "key_attribute": "AI-powered cancer diagnostics",
      "description": "Tempus uses AI to analyze clinical and molecular data to personalize cancer treatment.",
      "source_url": "https://www.forbes.com/...",
      "source_snippet": "Tempus is a leader in AI-driven precision medicine",
      "confidence": "high"
    }
  ],
  "cached": false,
  "search_queries": ["top AI healthcare startups", "AI healthcare companies what they do", "best AI health startups review"],
  "search_count": 3,
  "latency_ms": 8200
}
```

---

## Known Limitations

- **Scraping is basic** — strips HTML tags but does not handle JS-rendered pages, paywalls, or bot detection
- **Groq free tier** — 100k tokens/day limit; heavy usage will hit this cap. Switch model to llama-3.1-8b-instant for a separate limit, or upgrade to Groq Dev tier
- **Brave free tier** — 2,000 queries/month
- **Cache is short lived** — lost on server restart, a Redis layer would make this persistent across deploys
- **No pagination** — only fetches the first page of results per search query
- **Confidence scoring is LLM-inferred** — not computed from hard signals like exact mention count across sources
