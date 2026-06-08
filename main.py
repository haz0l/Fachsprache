import sys
import threading
import uvicorn
from dotenv import load_dotenv

load_dotenv()

from src.web_server import app
from src.mcp_server import mcp
from src.config import WEB_HOST, WEB_PORT


def _run_web():
    uvicorn.run(app, host=WEB_HOST, port=WEB_PORT, log_level="warning")


if __name__ == "__main__":
    web_only = "--web" in sys.argv

    web_thread = threading.Thread(target=_run_web, daemon=True)
    web_thread.start()
    print(f"[FachSprache] Web UI -> http://localhost:{WEB_PORT}")

    if web_only:
        print("[FachSprache] Running in web-only mode. Press Ctrl+C to stop.")
        try:
            web_thread.join()
        except KeyboardInterrupt:
            print("\n[FachSprache] Stopped.")
    else:
        print("[FachSprache] MCP server starting on stdio...")
        mcp.run(transport="stdio")
