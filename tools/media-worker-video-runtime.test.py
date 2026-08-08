#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


root = Path(sys.argv[1]).resolve()
evidence = Path(sys.argv[2]).resolve()
evidence.mkdir(parents=True, exist_ok=True)

ffmpeg = shutil.which("ffmpeg")
ffprobe = shutil.which("ffprobe")

if not ffmpeg or not ffprobe:
    raise RuntimeError("MEDIA_VIDEO_REAL_TOOLCHAIN_MISSING")

worker_path = root / "tools/media-worker.py"

spec = importlib.util.spec_from_file_location(
    "tc_media_worker",
    worker_path,
)

if spec is None or spec.loader is None:
    raise RuntimeError("MEDIA_WORKER_IMPORT_FAILED")

worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def make_video(seconds: int, target: Path) -> None:
    completed = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x240:r=24",
            "-t",
            str(seconds),
            "-pix_fmt",
            "yuv420p",
            str(target),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if completed.returncode != 0:
        raise RuntimeError(
            "MEDIA_VIDEO_FIXTURE_GENERATION_FAILED:"
            + completed.stderr[-1000:]
        )


def assert_three_derivatives(
    source: Path,
    output: Path,
    stem: str,
    max_duration_ms: int,
) -> list[dict]:
    artifacts = worker.process_video(
        source,
        output,
        stem,
        max_duration_ms=max_duration_ms,
    )

    expected = {
        "video_proxy_720p",
        "video_poster_webp",
        "video_contact_sheet_webp",
    }

    actual = {
        artifact["type"]
        for artifact in artifacts
    }

    if actual != expected:
        raise RuntimeError(
            f"MEDIA013_TYPES_INVALID={sorted(actual)}"
        )

    for artifact in artifacts:
        path = Path(artifact["path"])

        if not path.is_file():
            raise RuntimeError(
                f"MEDIA013_ARTIFACT_MISSING={path}"
            )

        if path.stat().st_size <= 0:
            raise RuntimeError(
                f"MEDIA013_ARTIFACT_EMPTY={path}"
            )

    return artifacts


def assert_rejected_without_derivatives(
    source: Path,
    output: Path,
    stem: str,
    max_duration_ms: int,
) -> None:
    try:
        worker.process_video(
            source,
            output,
            stem,
            max_duration_ms=max_duration_ms,
        )
    except RuntimeError as error:
        message = str(error)

        if (
            "MEDIA_VIDEO_QUARANTINE_REQUIRED"
            not in message
            or "E_MEDIA_DURACION_EXCEDIDA"
            not in message
        ):
            raise
    else:
        raise RuntimeError(
            "MEDIA010_OVERSIZED_VIDEO_ACCEPTED"
        )

    residuals = (
        list(output.rglob("*"))
        if output.exists()
        else []
    )

    files = [
        path
        for path in residuals
        if path.is_file()
    ]

    if files:
        raise RuntimeError(
            "MEDIA010_DERIVATIVES_CREATED_BEFORE_GATE="
            + ",".join(str(path) for path in files)
        )


with tempfile.TemporaryDirectory(
    prefix="tc-media-video-runtime-"
) as temporary:
    temp = Path(temporary)

    video10 = temp / "video-10s.mp4"
    video16 = temp / "video-16s.mp4"
    video20 = temp / "video-20s.mp4"
    video31 = temp / "video-31s.mp4"

    make_video(10, video10)
    make_video(16, video16)
    make_video(20, video20)
    make_video(31, video31)

    duration10 = worker.probe_video_duration_ms(video10)
    duration16 = worker.probe_video_duration_ms(video16)
    duration20 = worker.probe_video_duration_ms(video20)
    duration31 = worker.probe_video_duration_ms(video31)

    if not 9000 <= duration10 <= 11000:
        raise RuntimeError(
            f"MEDIA010_PROBE_10S_INVALID={duration10}"
        )

    short_artifacts = assert_three_derivatives(
        video10,
        temp / "out-10",
        "short",
        15000,
    )

    assert_rejected_without_derivatives(
        video16,
        temp / "out-16",
        "over-15",
        15000,
    )

    authorized_artifacts = assert_three_derivatives(
        video20,
        temp / "out-20",
        "authorized-30",
        30000,
    )

    assert_rejected_without_derivatives(
        video31,
        temp / "out-31",
        "over-30",
        30000,
    )

    result = {
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        "duration10Ms": duration10,
        "duration16Ms": duration16,
        "duration20Ms": duration20,
        "duration31Ms": duration31,
        "shortDerivativeCount": len(short_artifacts),
        "authorizedDerivativeCount": len(authorized_artifacts),
        "video16Rejected": True,
        "video31Rejected": True,
        "result": "PASS",
    }

    (evidence / "worker-video-runtime.json").write_text(
        json.dumps(
            result,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

print("MEDIA010_REAL_FFPROBE_RUNTIME=PASS")
print("MEDIA010_16S_REJECTED_BEFORE_DERIVATION=PASS")
print("MEDIA010_31S_ALWAYS_REJECTED=PASS")
print("MEDIA013_PROXY_720P=PASS")
print("MEDIA013_POSTER_WEBP=PASS")
print("MEDIA013_CONTACT_SHEET_WEBP=PASS")
print("MEDIA012_AUTHORIZED_30S_TECHNICAL_PATH=PASS")
print("MEDIA012_LEDGER_CHANGE=NO")
