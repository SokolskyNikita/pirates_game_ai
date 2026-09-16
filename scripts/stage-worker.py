"""Stage just the deployable Python source and calibration data for Wrangler."""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / ".build" / "python"


def stage_worker(*, dev: bool = False) -> Path:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    shutil.copy2(ROOT / "worker" / "entry.py", STAGE / "worker.py")
    for path in sorted((ROOT / "calculator").rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(ROOT)
        if path.suffix != ".py" and not (relative.parts[1] == "data" and path.suffix == ".json"):
            continue
        destination = STAGE / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    if dev:
        sys.path.insert(0, str(ROOT))
        from calculator.artifacts import model_fingerprint
        (STAGE / "calculator" / "_generated.py").write_text(
            "\"\"\"Development runtime; precomputed assets are deliberately disabled.\"\"\"\n"
            f"MODEL_FINGERPRINT = {model_fingerprint(ROOT)!r}\nPRECOMPUTED_PATHS = {{}}\n"
        )
    return STAGE


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true", help="Disable precomputed production assets")
    args = parser.parse_args()
    print(f"Staged Python Worker at {stage_worker(dev=args.dev).relative_to(ROOT)}")
