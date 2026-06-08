from mcp.server.fastmcp import FastMCP
from src import services

mcp = FastMCP("FachSprache", instructions="German business term lookup, glossary management, and financial news.")


@mcp.tool()
def lookup_term(term: str) -> dict:
    """Translate and deconstruct a German business term using Gemini."""
    return services.lookup_term(term)


@mcp.tool()
def save_term(
    term: str,
    translation: str,
    explanation: str,
    example: str,
    deconstruction: str = "N/A",
    tags: list = [],
) -> dict:
    """Save a German term and its details to the personal glossary. Optionally supply tags."""
    return services.save_term(term, translation, explanation, example, deconstruction, tags)


@mcp.tool()
def view_glossary(query: str = "", tag: str = "") -> list:
    """Return all saved glossary terms, optionally filtered by query string or tag."""
    return services.get_glossary(query or None, tag or None)


@mcp.tool()
def get_news() -> list:
    """Fetch latest German financial and business news headlines."""
    return services.get_news()


@mcp.tool()
def delete_term(term: str) -> dict:
    """Remove a term from the glossary. Returns success status."""
    removed = services.delete_term(term)
    return {"term": term, "deleted": removed}


@mcp.tool()
def log_heard_term(term: str) -> dict:
    """Add a German term to today's 'Heard Today' log (auto-clears each day)."""
    return services.log_heard(term)


@mcp.tool()
def get_activity_log() -> dict:
    """Return the activity log as {YYYY-MM-DD: count} for the last year."""
    return services.get_activity_log()
