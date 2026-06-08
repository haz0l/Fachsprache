import feedparser

feeds = {
    "FAZ Wirtschaft": "https://www.faz.net/rss/aktuell/wirtschaft/",
    "Tagesschau Wirtschaft": "https://www.tagesschau.de/xml/rss2_https/",
    "Deutsche Bundesbank": "https://www.bundesbank.de/en/homepage/rss/deutsche-bundesbank-s-rss-feed-620440",
}

print("=== Feed Verification ===\n")
for name, url in feeds.items():
    try:
        feed = feedparser.parse(url)
        status = getattr(feed, "status", "N/A")
        count = len(feed.entries)
        print(f"[{name}]")
        print(f"  URL:     {url}")
        print(f"  Status:  {status}")
        print(f"  Entries: {count}")
        if count > 0:
            print(f"  Sample:  {feed.entries[0].get('title', 'no title')[:80]}")
        else:
            print(f"  WARNING: 0 entries returned — feed may be blocked or empty")
        if feed.bozo:
            print(f"  BOZO:    {feed.bozo_exception}")
    except Exception as e:
        print(f"[{name}] ERROR: {e}")
    print()
