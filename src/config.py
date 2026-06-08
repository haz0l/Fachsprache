import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR           = Path(__file__).parent.parent
GLOSSARY_PATH      = BASE_DIR / "data" / "glossary.json"
HEARD_PATH         = BASE_DIR / "data" / "heard_today.json"
ACTIVITY_LOG_PATH  = BASE_DIR / "data" / "activity_log.json"

# ── AI provider ───────────────────────────────────────────────────────────────
# Set AI_PROVIDER=gemini to use Gemini (requires valid GEMINI_API_KEY)
# Defaults to groq (free, no billing required)
AI_PROVIDER   = os.getenv("AI_PROVIDER", "groq")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL    = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

NEWSAPI_KEY   = os.getenv("NEWSAPI_KEY", "")

WEB_PORT = int(os.environ.get("PORT", 8080))
WEB_HOST = "0.0.0.0"

RSS_FEEDS = [
    {"name": "FAZ Wirtschaft",     "url": "https://www.faz.net/rss/aktuell/wirtschaft/",  "source_type": "rss"},
    {"name": "Tagesschau",         "url": "https://www.tagesschau.de/xml/rss2_https/",     "source_type": "rss"},
    {"name": "Spiegel Wirtschaft", "url": "https://www.spiegel.de/wirtschaft/index.rss",   "source_type": "rss"},
]

REDDIT_FEEDS = [
    {"name": "r/finanzen",          "url": "https://www.reddit.com/r/finanzen/.rss",          "source_type": "reddit"},
    {"name": "r/de",                "url": "https://www.reddit.com/r/de/.rss",                "source_type": "reddit"},
    {"name": "r/eupersonalfinance", "url": "https://www.reddit.com/r/eupersonalfinance/.rss", "source_type": "reddit"},
    {"name": "r/investing",         "url": "https://www.reddit.com/r/investing/.rss",         "source_type": "reddit"},
    {"name": "r/economics",         "url": "https://www.reddit.com/r/economics/.rss",         "source_type": "reddit"},
    {"name": "r/worldnews",         "url": "https://www.reddit.com/r/worldnews/.rss",         "source_type": "reddit"},
    {"name": "r/europe",            "url": "https://www.reddit.com/r/europe/.rss",            "source_type": "reddit"},
]

PREDEFINED_TAGS = [
    "accounting", "banking", "M&A", "markets",
    "meetings", "legal", "macro", "CFO advisory",
]

SYSTEM_PROMPT = """You are a German business and financial terminology expert.
When given a German term, respond in this EXACT JSON format with no markdown fencing:
{
  "term": "<the original German term>",
  "translation": "<English translation>",
  "explanation": "<plain English explanation with business/office context, 2-3 sentences>",
  "example": "<a realistic example sentence showing how this term is used in a German office or meeting, written in German with an English translation in parentheses>",
  "deconstruction": "<if the term is a compound word, break it down: e.g. Liquiditaetsplanung -> Liquiditaet (liquidity) + Planung (planning). If not a compound word, write N/A>"
}
Return only valid JSON. No extra text before or after."""
