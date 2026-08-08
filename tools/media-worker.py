#!/usr/bin/env python3
"""Deterministic local media derivative worker; never contacts remote services."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

WORKER_VERSION = "media-worker/v1"


from PIL import Image

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_save(image, path: Path, **options) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=path.suffix, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        image.save(temporary, **options)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def webp_artifact(image, path: Path, max_size: tuple[int, int], kind: str) -> dict:
    from PIL import ImageOps

    normalized = ImageOps.exif_transpose(image).convert("RGB")
    normalized.thumbnail(max_size)
    atomic_save(normalized, path, format="WEBP", quality=82, method=6)
    return {
        "type": kind,
        "path": str(path),
        "mimeType": "image/webp",
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "width": normalized.width,
        "height": normalized.height,
    }


def process_image(source: Path, output: Path, stem: str) -> list[dict]:
    from PIL import Image

    with Image.open(source) as image:
        return [
            webp_artifact(image, output / f"{stem}.review.webp", (1600, 1600), "review_webp"),
            webp_artifact(image, output / f"{stem}.thumb.webp", (320, 320), "thumbnail_webp"),
        ]


def process_pdf(source: Path, output: Path, stem: str) -> list[dict]:
    pdftoppm = os.environ.get("TC_MEDIA_PDFTOPPM") or shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("MEDIA_PDFTOPPM_UNAVAILABLE")
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="tc-media-pdf-") as directory:
        prefix = Path(directory) / "page"
        completed = subprocess.run(
            [pdftoppm, "-f", "1", "-singlefile", "-png", "-r", "144", str(source), str(prefix)],
            check=False, capture_output=True, text=True, timeout=30,
        )
        if completed.returncode != 0:
            raise RuntimeError("MEDIA_PDF_RENDER_FAILED")
        with Image.open(prefix.with_suffix(".png")) as image:
            return [
                webp_artifact(image, output / f"{stem}.poster.webp", (1600, 1600), "pdf_poster_webp"),
                webp_artifact(image, output / f"{stem}.thumb.webp", (320, 320), "thumbnail_webp"),
            ]


def probe_video_duration_ms(source: Path) -> int:
    ffprobe = (
        os.environ.get("TC_MEDIA_FFPROBE")
        or shutil.which("ffprobe")
    )

    if not ffprobe:
        raise RuntimeError(
            "MEDIA_VIDEO_PROBE_UNAVAILABLE"
        )

    completed = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(source),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )

    if completed.returncode != 0:
        raise RuntimeError(
            "MEDIA_VIDEO_PROBE_FAILED"
        )

    try:
        duration_ms = int(
            round(float(completed.stdout.strip()) * 1000)
        )
    except (TypeError, ValueError):
        raise RuntimeError(
            "MEDIA_VIDEO_DURATION_INVALID"
        )

    if duration_ms <= 0:
        raise RuntimeError(
            "MEDIA_VIDEO_DURATION_INVALID"
        )

    return duration_ms


def process_video(
    source: Path,
    output: Path,
    stem: str,
    max_duration_ms: int = 15000,
) -> list[dict]:
    if max_duration_ms not in (15000, 30000):
        raise RuntimeError(
            "MEDIA_VIDEO_DURATION_POLICY_INVALID"
        )

    # Autoridad obligatoria antes de crear cualquier derivado.
    duration_ms = probe_video_duration_ms(source)

    if duration_ms > max_duration_ms:
        raise RuntimeError(
            "MEDIA_VIDEO_QUARANTINE_REQUIRED:"
            "E_MEDIA_DURACION_EXCEDIDA"
        )

    ffmpeg = os.environ.get("TC_MEDIA_FFMPEG") or shutil.which("ffmpeg")

    if not ffmpeg:
        raise RuntimeError("MEDIA_VIDEO_TOOLCHAIN_UNAVAILABLE")
    proxy = output / f"{stem}.proxy.mp4"
    poster = output / f"{stem}.poster.webp"
    contact = output / f"{stem}.contact.webp"

    output.mkdir(parents=True, exist_ok=True)

    def run_ffmpeg(
        command: list[str],
        failure_code: str,
    ) -> None:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if completed.returncode != 0:
            stderr_tail = (
                completed.stderr or ""
            ).strip()[-3000:]

            raise RuntimeError(
                failure_code
                + ":"
                + stderr_tail
            )

    run_ffmpeg(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vf",
            "scale=-2:min(720\\,ih)",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(proxy),
        ],
        "MEDIA_VIDEO_PROXY_FAILED",
    )

    with tempfile.TemporaryDirectory(
        prefix="tc-media-video-frames-",
    ) as directory:
        frame_directory = Path(directory)
        poster_png = frame_directory / "poster.png"
        frame_pattern = (
            frame_directory
            / "contact-%02d.png"
        )

        run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-ss",
                "0",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                "scale=960:-2",
                "-c:v",
                "png",
                str(poster_png),
            ],
            "MEDIA_VIDEO_POSTER_EXTRACTION_FAILED",
        )

        run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source),
                "-vf",
                "fps=1/5,scale=320:-2",
                "-frames:v",
                "6",
                "-c:v",
                "png",
                str(frame_pattern),
            ],
            "MEDIA_VIDEO_CONTACT_FRAMES_FAILED",
        )

        if not poster_png.is_file():
            raise RuntimeError(
                "MEDIA_VIDEO_POSTER_FRAME_MISSING"
            )

        frame_paths = sorted(
            frame_directory.glob(
                "contact-*.png"
            )
        )

        if not frame_paths:
            raise RuntimeError(
                "MEDIA_VIDEO_CONTACT_FRAMES_MISSING"
            )

        with Image.open(poster_png) as image:
            poster_source = image.convert("RGB")

            poster_artifact = webp_artifact(
                poster_source,
                poster,
                (960, 960),
                "video_poster_webp",
            )

        cell_width = 320
        cell_height = 180
        columns = 3
        rows = 2

        contact_canvas = Image.new(
            "RGB",
            (
                cell_width * columns,
                cell_height * rows,
            ),
            (0, 0, 0),
        )

        try:
            for index, frame_path in enumerate(
                frame_paths[:6]
            ):
                with Image.open(frame_path) as frame:
                    tile = frame.convert("RGB")
                    tile.thumbnail(
                        (
                            cell_width,
                            cell_height,
                        )
                    )

                    column = index % columns
                    row = index // columns

                    x = (
                        column * cell_width
                        + (cell_width - tile.width) // 2
                    )
                    y = (
                        row * cell_height
                        + (cell_height - tile.height) // 2
                    )

                    contact_canvas.paste(
                        tile,
                        (x, y),
                    )

            contact_artifact = webp_artifact(
                contact_canvas,
                contact,
                (
                    cell_width * columns,
                    cell_height * rows,
                ),
                "video_contact_sheet_webp",
            )
        finally:
            contact_canvas.close()

    return [
        {
            "type": "video_proxy_720p",
            "path": str(proxy),
            "mimeType": "video/mp4",
            "bytes": proxy.stat().st_size,
            "sha256": sha256(proxy),
        },
        poster_artifact,
        contact_artifact,
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--attachment-id", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--kind", choices=("image", "pdf", "video"), required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    source, output = Path(args.input).resolve(), Path(args.output_dir).resolve()
    if not source.is_file() or not output.parent.exists():
        raise SystemExit("MEDIA_WORKER_LOCAL_PATH_INVALID")
    actual = sha256(source)
    if actual != args.source_sha256:
        raise SystemExit("MEDIA_SOURCE_CHECKSUM_MISMATCH")

    stem = f"{args.attachment_id}.{actual[:16]}.v1"
    processors = {"image": process_image, "pdf": process_pdf, "video": process_video}
    artifacts = processors[args.kind](source, output, stem)
    manifest = {
        "workerVersion": WORKER_VERSION,
        "attachmentId": args.attachment_id,
        "sourceSha256": actual,
        "kind": args.kind,
        "artifacts": artifacts,
    }
    manifest_path = Path(args.manifest).resolve()
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, manifest_path)
    print("MEDIA_WORKER=PASS")
    print(f"DERIVATIVES={len(artifacts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
