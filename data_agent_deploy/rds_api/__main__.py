import os
from pathlib import Path

from dotenv import load_dotenv
import uvicorn

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from .app import Settings, create_app

if __name__ == "__main__":
    uvicorn.run(create_app(Settings.from_env()), host="127.0.0.1", port=int(os.getenv("RDS_API_PORT", "8766")))
