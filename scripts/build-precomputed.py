"""Build Python-owned presentation metadata and common-scenario assets."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from calculator.artifacts import build_artifacts  # noqa: E402

if __name__ == "__main__":
    build_artifacts(ROOT, metadata_only="--metadata-only" in sys.argv)
