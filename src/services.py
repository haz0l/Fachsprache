import json
import re as _re
import time as _time
import datetime as _dt
import random as _random
import urllib.request as _urllib
import urllib.parse as _urllib_parse
import feedparser
from src.config import (
    GLOSSARY_PATH, HEARD_PATH, ACTIVITY_LOG_PATH,
    RSS_FEEDS, REDDIT_FEEDS, NEWSAPI_KEY, SYSTEM_PROMPT,
    AI_PROVIDER,
    GEMINI_API_KEY, GEMINI_MODEL,
    GROQ_API_KEY, GROQ_MODEL,
)


# ── Glossary storage ──────────────────────────────────────────────────────────

def _read_glossary() -> list[dict]:
    if not GLOSSARY_PATH.exists():
        return []
    with open(GLOSSARY_PATH, encoding="utf-8") as f:
        return json.load(f)


def _write_glossary(entries: list[dict]) -> None:
    GLOSSARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GLOSSARY_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


def get_glossary(query: str | None = None, tag: str | None = None) -> list[dict]:
    entries = _read_glossary()
    if query:
        q = query.lower()
        entries = [
            e for e in entries
            if q in e.get("term", "").lower()
            or q in e.get("translation", "").lower()
            or q in e.get("explanation", "").lower()
        ]
    if tag:
        t = tag.lower()
        entries = [
            e for e in entries
            if t in [x.lower() for x in e.get("tags", [])]
        ]
    return entries


def save_term(
    term: str,
    translation: str,
    explanation: str,
    example: str,
    deconstruction: str = "N/A",
    tags: list | None = None,
) -> dict:
    entries = _read_glossary()
    existing_idx = next(
        (i for i, e in enumerate(entries) if e["term"].lower() == term.lower()), None
    )
    entry = {
        "term":           term,
        "translation":    translation,
        "explanation":    explanation,
        "example":        example,
        "deconstruction": deconstruction,
        "tags":           tags or [],
        "related_terms":  [],
    }
    if existing_idx is not None:
        # Preserve existing related_terms when updating
        entry["related_terms"] = entries[existing_idx].get("related_terms", [])
        entries[existing_idx] = entry
    else:
        entries.append(entry)
    _write_glossary(entries)
    log_activity(1)
    return entry


def delete_term(term: str) -> bool:
    entries = _read_glossary()
    updated = [e for e in entries if e["term"].lower() != term.lower()]
    if len(updated) == len(entries):
        return False
    _write_glossary(updated)
    return True


# ── Activity log ──────────────────────────────────────────────────────────────

def _read_activity() -> dict:
    if not ACTIVITY_LOG_PATH.exists():
        return {}
    try:
        with open(ACTIVITY_LOG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _write_activity(data: dict) -> None:
    ACTIVITY_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(ACTIVITY_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def log_activity(count: int = 1) -> None:
    """Increment today's activity count by `count`."""
    today = _dt.date.today().isoformat()
    data  = _read_activity()
    data[today] = data.get(today, 0) + count
    _write_activity(data)


def get_activity_log() -> dict:
    """Return the full activity log {YYYY-MM-DD: count}."""
    return _read_activity()


# ── RSS / Reddit / NewsAPI aggregator ────────────────────────────────────────

def _clean_html(text: str) -> str:
    """Strip HTML tags and decode common entities."""
    if not text:
        return ""
    text = _re.sub(r"<[^>]+>", " ", text)
    text = _re.sub(r"&amp;",   "&",  text)
    text = _re.sub(r"&lt;",    "<",  text)
    text = _re.sub(r"&gt;",    ">",  text)
    text = _re.sub(r"&nbsp;",  " ",  text)
    text = _re.sub(r"&quot;",  '"',  text)
    text = _re.sub(r"&#?\w+;", "",   text)
    text = _re.sub(r"\s+",     " ",  text)
    return text.strip()


def _extract_image(entry) -> str:
    """Try every common RSS image location; return first URL found."""
    # media:content
    for item in (entry.get("media_content") or []):
        if isinstance(item, dict):
            url = item.get("url", "")
            if url:
                return url
    # media:thumbnail
    for item in (entry.get("media_thumbnail") or []):
        if isinstance(item, dict):
            url = item.get("url", "")
            if url:
                return url
    # <enclosure>
    for enc in (entry.get("enclosures") or []):
        if not isinstance(enc, dict):
            continue
        href = enc.get("href") or enc.get("url", "")
        mime = enc.get("type", "")
        if href and ("image" in mime or
                     href.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))):
            return href
    # <link rel="enclosure">
    for link in (entry.get("links") or []):
        if isinstance(link, dict) and link.get("rel") == "enclosure":
            href = link.get("href", "")
            if href and "image" in link.get("type", ""):
                return href
    return ""


def _format_date(entry) -> str:
    for attr in ("published_parsed", "updated_parsed"):
        t = entry.get(attr)
        if t:
            try:
                return _time.strftime("%d %b %Y", t)
            except Exception:
                pass
    return ""


def _format_newsapi_date(s: str) -> str:
    """Convert ISO 8601 date string to readable format."""
    if not s:
        return ""
    try:
        dt = _dt.datetime.strptime(s[:10], "%Y-%m-%d")
        return dt.strftime("%d %b %Y")
    except Exception:
        return ""


def _fetch_newsapi_headlines() -> list[dict]:
    """Fetch German finance/business headlines from NewsAPI."""
    if not NEWSAPI_KEY:
        return []
    # Use German business keywords so language=de filter actually finds articles
    params = _urllib_parse.urlencode({
        "q":        "Wirtschaft OR Finanzen OR DAX OR Bundesbank OR Konjunktur",
        "language": "de",
        "pageSize": 20,
        "sortBy":   "publishedAt",
        "apiKey":   NEWSAPI_KEY,
    })
    url = f"https://newsapi.org/v2/everything?{params}"
    try:
        req = _urllib.Request(url, headers={"User-Agent": "FachSprache/1.0"})
        with _urllib.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        results = []
        for a in (data.get("articles") or [])[:15]:
            title = _clean_html(a.get("title") or "")
            # Skip articles with removed/empty content
            if not title or "[Removed]" in title:
                continue
            results.append({
                "title":       title,
                "summary":     _clean_html(a.get("description") or "")[:400],
                "source":      (a.get("source") or {}).get("name") or "NewsAPI",
                "link":        a.get("url") or "",
                "image":       a.get("urlToImage") or "",
                "date":        _format_newsapi_date(a.get("publishedAt") or ""),
                "source_type": "newsapi",
            })
        return results
    except Exception:
        return []


def get_news() -> list[dict]:
    headlines  = []
    seen_titles: set[str] = set()

    def _add(item: dict) -> None:
        key = item["title"].lower().strip()
        if key and key not in seen_titles:
            seen_titles.add(key)
            headlines.append(item)

    # ── Standard RSS feeds ────────────────────────────────────────────────
    for feed_cfg in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_cfg["url"])
            for entry in feed.entries[:10]:
                raw = entry.get("summary") or entry.get("description") or ""
                _add({
                    "title":       _clean_html(entry.get("title", "")),
                    "summary":     _clean_html(raw)[:400],
                    "source":      feed_cfg["name"],
                    "link":        entry.get("link", ""),
                    "image":       _extract_image(entry),
                    "date":        _format_date(entry),
                    "source_type": feed_cfg.get("source_type", "rss"),
                })
        except Exception:
            pass

    # ── Reddit RSS feeds ──────────────────────────────────────────────────
    # Fetch raw bytes first so feedparser can properly detect encoding
    _REDDIT_HEADERS = {
        "User-Agent": "FachSprache/1.0 (German business vocabulary app)",
        "Accept":     "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    }
    for feed_cfg in REDDIT_FEEDS:
        try:
            req  = _urllib.Request(feed_cfg["url"], headers=_REDDIT_HEADERS)
            with _urllib.urlopen(req, timeout=10) as resp:
                raw_bytes = resp.read()
            feed = feedparser.parse(raw_bytes)
            for entry in feed.entries[:5]:
                raw = entry.get("summary") or entry.get("description") or ""
                title = _clean_html(entry.get("title", ""))
                if not title:
                    continue
                _add({
                    "title":       title,
                    "summary":     _clean_html(raw)[:400],
                    "source":      feed_cfg["name"],
                    "link":        entry.get("link", ""),
                    "image":       _extract_image(entry),
                    "date":        _format_date(entry),
                    "source_type": "reddit",
                })
        except Exception:
            pass

    # ── NewsAPI ───────────────────────────────────────────────────────────
    for item in _fetch_newsapi_headlines():
        _add(item)

    return headlines


# ── AI lookup (provider-agnostic) ─────────────────────────────────────────────

def _parse_ai_response(raw: str, term: str) -> dict:
    """Strip markdown fences and parse JSON from AI response."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "term":          term,
            "translation":   "Parse error",
            "explanation":   raw[:300],
            "example":       "",
            "deconstruction": "N/A",
        }


def _error_result(term: str, msg: str) -> dict:
    return {
        "term":          term,
        "translation":   "API Error",
        "explanation":   msg,
        "example":       "",
        "deconstruction": "N/A",
        "error":         True,
    }


def _lookup_groq(term: str) -> dict:
    from groq import Groq
    client = Groq(api_key=GROQ_API_KEY)
    try:
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": f"Explain this German business term: {term}"},
            ],
        )
        raw = resp.choices[0].message.content
        return _parse_ai_response(raw, term)
    except Exception as exc:
        msg = str(exc)
        if "401" in msg or "invalid_api_key" in msg.lower():
            friendly = "Invalid Groq API key. Get a free key at https://console.groq.com"
        elif "429" in msg or "rate_limit" in msg.lower():
            friendly = "Groq rate limit hit. Wait a moment and try again."
        else:
            friendly = f"Groq error: {msg[:200]}"
        return _error_result(term, friendly)


def _lookup_gemini(term: str) -> dict:
    from google import genai
    client = genai.Client(api_key=GEMINI_API_KEY)
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=f"Explain this German business term: {term}",
            config=genai.types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
            ),
        )
        return _parse_ai_response(response.text, term)
    except Exception as exc:
        msg = str(exc)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            friendly = "Gemini quota exceeded. Check billing at https://aistudio.google.com"
        elif "401" in msg or "403" in msg or "PERMISSION_DENIED" in msg:
            friendly = "Invalid or denied Gemini API key."
        else:
            friendly = f"Gemini error: {msg[:200]}"
        return _error_result(term, friendly)


def lookup_term(term: str) -> dict:
    result = _lookup_gemini(term) if AI_PROVIDER == "gemini" else _lookup_groq(term)
    if not result.get("error"):
        log_activity(1)
    return result


# ── Feature 1: Article Context Explainer ─────────────────────────────────────

_ARTICLE_SYSTEM_PROMPT = (
    "You are a financial analyst briefing a junior intern at a German CFO advisory firm.\n"
    "Given a news headline and summary, return ONLY a valid JSON object with exactly "
    "these four fields:\n"
    '{\n'
    '  "what": "<one sentence: what is happening>",\n'
    '  "why_it_matters": "<one sentence: why this matters for German/European finance or CFO advisory work>",\n'
    '  "background": "<2-3 sentences of context a newcomer needs to understand this story>",\n'
    '  "key_terms": [\n'
    '    {"term": "<German finance/business term>", "brief_english_meaning": "<concise English meaning>"}\n'
    '  ]\n'
    '}\n'
    "Include up to 4 items in key_terms. "
    "Return only the JSON object. No markdown fencing. No extra text."
)


def _parse_article_response(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "what":           "Could not parse the AI response.",
            "why_it_matters": "",
            "background":     raw[:300],
            "key_terms":      [],
        }


def explain_article_context(headline: str, summary: str) -> dict:
    """Call the active AI provider to explain a news article in a CFO advisory context."""
    user_msg = f"Headline: {headline}\nSummary: {summary}"
    try:
        if AI_PROVIDER == "gemini":
            from google import genai
            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=user_msg,
                config=genai.types.GenerateContentConfig(
                    system_instruction=_ARTICLE_SYSTEM_PROMPT,
                    temperature=0.3,
                ),
            )
            return _parse_article_response(response.text)
        else:
            from groq import Groq
            client = Groq(api_key=GROQ_API_KEY)
            resp = client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": _ARTICLE_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
            )
            return _parse_article_response(resp.choices[0].message.content)
    except Exception as exc:
        return {
            "what":           f"AI error: {str(exc)[:200]}",
            "why_it_matters": "",
            "background":     "",
            "key_terms":      [],
            "error":          True,
        }


# ── Feature 2: Term of the Day ────────────────────────────────────────────────

def suggest_related_terms(new_term: str, existing_terms: list[str]) -> list[dict]:
    """Ask AI which existing glossary terms relate to new_term.
    Returns [{term, reason}, ...] with up to 3 suggestions."""
    if not existing_terms:
        return []
    terms_str = ", ".join(existing_terms[:30])
    prompt = (
        f'You are a German business terminology expert.\n'
        f'A learner just saved the term: "{new_term}".\n'
        f'From this list of already-saved terms: {terms_str}\n'
        f'Identify up to 3 terms that are semantically or conceptually related to "{new_term}".\n'
        f'Return ONLY a JSON array like:\n'
        f'[{{"term": "Kurzarbeit", "reason": "Both relate to labor cost management"}}]\n'
        f'If no terms are clearly related, return an empty array [].\n'
        f'Return only the JSON array, no markdown, no extra text.'
    )
    try:
        if AI_PROVIDER == "gemini":
            from google import genai
            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=genai.types.GenerateContentConfig(temperature=0.2),
            )
            raw = response.text
        else:
            from groq import Groq
            client = Groq(api_key=GROQ_API_KEY)
            resp = client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.choices[0].message.content
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        result = json.loads(raw)
        if isinstance(result, list):
            return result[:3]
        return []
    except Exception:
        return []


def link_terms(term_a: str, term_b: str) -> bool:
    """Bidirectionally link two glossary entries via related_terms."""
    entries = _read_glossary()
    idx_a = next((i for i, e in enumerate(entries) if e["term"].lower() == term_a.lower()), None)
    idx_b = next((i for i, e in enumerate(entries) if e["term"].lower() == term_b.lower()), None)
    if idx_a is None or idx_b is None:
        return False
    # Canonical names from entries
    name_a = entries[idx_a]["term"]
    name_b = entries[idx_b]["term"]
    rel_a = entries[idx_a].get("related_terms", [])
    if name_b not in rel_a:
        rel_a.append(name_b)
    entries[idx_a]["related_terms"] = rel_a
    rel_b = entries[idx_b].get("related_terms", [])
    if name_a not in rel_b:
        rel_b.append(name_a)
    entries[idx_b]["related_terms"] = rel_b
    _write_glossary(entries)
    return True


def get_term_of_the_day() -> dict | None:
    """Return a deterministically chosen term based on today's date."""
    entries = _read_glossary()
    if not entries:
        return None
    today = _dt.date.today()
    seed  = today.year * 10000 + today.month * 100 + today.day
    rng   = _random.Random(seed)
    return rng.choice(entries)


# ── Feature 3: Heard Today ────────────────────────────────────────────────────

def _read_heard() -> list[dict]:
    """Read heard_today.json; return [] if the file is from a previous day."""
    if not HEARD_PATH.exists():
        return []
    try:
        with open(HEARD_PATH, encoding="utf-8") as f:
            entries = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    if not entries:
        return []
    # Auto-clear if the most recent entry is from a previous calendar day
    last_date = entries[-1].get("timestamp", "")[:10]  # YYYY-MM-DD prefix
    if last_date != _dt.date.today().isoformat():
        return []
    return entries


def _write_heard(entries: list[dict]) -> None:
    HEARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(HEARD_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


def log_heard(term: str) -> dict:
    """Add a term to today's heard log. Ignores case-insensitive duplicates."""
    term    = term.strip()
    entries = _read_heard()
    if any(e["term"].lower() == term.lower() for e in entries):
        return {"term": term, "already_logged": True}
    entry = {"term": term, "timestamp": _dt.datetime.now().isoformat()}
    entries.append(entry)
    _write_heard(entries)
    log_activity(1)
    return entry


def get_heard() -> list[dict]:
    """Return today's heard terms list."""
    return _read_heard()
