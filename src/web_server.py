from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from src import services

app = FastAPI(title="FachSprache API")

STATIC_DIR = Path(__file__).parent.parent / "static"


class LookupRequest(BaseModel):
    term: str


class SaveRequest(BaseModel):
    term: str
    translation: str
    explanation: str
    example: str
    deconstruction: str = "N/A"
    tags: list[str] = []


class ExplainRequest(BaseModel):
    headline: str
    summary: str


class HeardRequest(BaseModel):
    term: str


class SuggestRelationsRequest(BaseModel):
    term: str


class LinkTermsRequest(BaseModel):
    term_a: str
    term_b: str


@app.post("/api/lookup")
async def api_lookup(req: LookupRequest):
    if not req.term.strip():
        raise HTTPException(status_code=400, detail="term is required")
    return services.lookup_term(req.term.strip())


@app.post("/api/glossary")
async def api_save(req: SaveRequest):
    return services.save_term(
        req.term, req.translation, req.explanation, req.example,
        req.deconstruction, req.tags,
    )


@app.get("/api/glossary")
async def api_view(query: str = "", tag: str = ""):
    return services.get_glossary(query or None, tag or None)


@app.delete("/api/glossary/{term}")
async def api_delete(term: str):
    removed = services.delete_term(term)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Term '{term}' not found")
    return {"term": term, "deleted": True}


@app.get("/api/news")
async def api_news():
    return services.get_news()


# ── Feature 1: Article Context Explainer ─────────────────────────────────────

@app.post("/api/explain-article")
async def api_explain_article(req: ExplainRequest):
    if not req.headline.strip():
        raise HTTPException(status_code=400, detail="headline is required")
    return services.explain_article_context(req.headline.strip(), req.summary.strip())


# ── Feature 2: Term of the Day ────────────────────────────────────────────────

@app.get("/api/term-of-the-day")
async def api_term_of_the_day():
    term = services.get_term_of_the_day()
    if term is None:
        return {"empty": True}
    return term


# ── Feature 3: Heard Today ────────────────────────────────────────────────────

@app.post("/api/heard")
async def api_log_heard(req: HeardRequest):
    if not req.term.strip():
        raise HTTPException(status_code=400, detail="term is required")
    return services.log_heard(req.term.strip())


@app.get("/api/heard")
async def api_get_heard():
    return services.get_heard()


# ── Feature 4: Activity Heatmap ───────────────────────────────────────────────

@app.get("/api/activity")
async def api_activity():
    return services.get_activity_log()


# ── Change 7: Knowledge Graph — Suggest Relations & Link ──────────────────────

@app.post("/api/glossary/suggest-relations")
async def api_suggest_relations(req: SuggestRelationsRequest):
    if not req.term.strip():
        raise HTTPException(status_code=400, detail="term is required")
    all_entries = services.get_glossary()
    other_terms = [e["term"] for e in all_entries if e["term"].lower() != req.term.lower()]
    return services.suggest_related_terms(req.term.strip(), other_terms)


@app.post("/api/glossary/link")
async def api_link_terms(req: LinkTermsRequest):
    if not req.term_a.strip() or not req.term_b.strip():
        raise HTTPException(status_code=400, detail="term_a and term_b are required")
    success = services.link_terms(req.term_a.strip(), req.term_b.strip())
    if not success:
        raise HTTPException(status_code=404, detail="One or both terms not found in glossary")
    return {"linked": True, "term_a": req.term_a, "term_b": req.term_b}


# Serve static files; index.html at root
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
