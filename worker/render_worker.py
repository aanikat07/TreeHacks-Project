import os
import re
import subprocess
import tempfile
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlencode

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)


def _send_callback(callback_url: str, callback_secret: str, payload: dict):
    print(
        f"[callback] sending status={payload.get('status')} jobId={payload.get('jobId')}",
        flush=True,
    )
    requests.post(
        callback_url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {callback_secret}",
        },
        timeout=60,
    )
    print(
        f"[callback] sent status={payload.get('status')} jobId={payload.get('jobId')}",
        flush=True,
    )


def _find_scene_name(code: str) -> str:
    match = re.search(r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*Scene\s*\)\s*:", code)
    return match.group(1) if match else "MainScene"


def _find_rendered_video(search_root: Path) -> Path:
    videos = list(search_root.rglob("*.mp4"))
    if not videos:
        raise RuntimeError("No rendered mp4 found")
    videos.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return videos[0]


def _upload_video_to_blob(job_id: str, video_path: Path, blob_token: str) -> str:
    pathname = f"manim-renders/{job_id}.mp4"
    query = urlencode({"pathname": pathname})
    url = f"https://vercel.com/api/blob/?{query}"

    size = video_path.stat().st_size
    print(
        f"[blob] upload start jobId={job_id} pathname={pathname} bytes={size}",
        flush=True,
    )
    with video_path.open("rb") as file_obj:
        response = requests.put(
            url,
            data=file_obj,
            headers={
                "Authorization": f"Bearer {blob_token}",
                "x-api-version": "12",
                "x-add-random-suffix": "0",
                "x-allow-overwrite": "1",
                "x-content-type": "video/mp4",
                "x-content-length": str(size),
            },
            timeout=300,
        )

    if not response.ok:
        raise RuntimeError(
            f"Blob upload failed ({response.status_code}): {response.text[:500]}"
        )

    data = response.json()
    uploaded_url = data.get("url")
    if not uploaded_url:
        raise RuntimeError("Blob upload response missing url")
    print(f"[blob] upload complete jobId={job_id} url={uploaded_url}", flush=True)
    return uploaded_url


def _render_job(
    job_id: str,
    python_code: str,
    callback_url: str,
    callback_secret: str,
    blob_token: str,
):
    started_at = time.time()
    print(f"[job] start jobId={job_id}", flush=True)
    try:
        _send_callback(
            callback_url,
            callback_secret,
            {"jobId": job_id, "status": "rendering"},
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            script_path = temp_path / "scene.py"
            media_dir = temp_path / "media"
            script_path.write_text(python_code, encoding="utf-8")
            scene_name = _find_scene_name(python_code)
            print(
                f"[job] render begin jobId={job_id} scene={scene_name} tempDir={temp_dir}",
                flush=True,
            )

            command = [
                "manim",
                "-ql",
                str(script_path),
                scene_name,
                "--media_dir",
                str(media_dir),
                "--output_file",
                f"{job_id}.mp4",
            ]
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=300,
            )
            print(f"[job] render complete jobId={job_id}", flush=True)

            output_video = _find_rendered_video(media_dir)
            print(
                f"[job] output found jobId={job_id} path={output_video}",
                flush=True,
            )
            uploaded_url = _upload_video_to_blob(job_id, output_video, blob_token)

            _send_callback(
                callback_url,
                callback_secret,
                {
                    "jobId": job_id,
                    "status": "completed",
                    "videoUrl": uploaded_url,
                },
            )
            elapsed = time.time() - started_at
            print(f"[job] done jobId={job_id} elapsedSec={elapsed:.2f}", flush=True)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        details = stderr or stdout or str(exc)
        if len(details) > 4000:
            details = details[:4000]
        print(
            f"[job] failed jobId={job_id} reason=CalledProcessError details={details}",
            flush=True,
        )
        _send_callback(
            callback_url,
            callback_secret,
            {
                "jobId": job_id,
                "status": "failed",
                "error": f"Manim failed: {details}",
            },
        )
    except subprocess.TimeoutExpired:
        print(f"[job] failed jobId={job_id} reason=TimeoutExpired", flush=True)
        _send_callback(
            callback_url,
            callback_secret,
            {
                "jobId": job_id,
                "status": "failed",
                "error": "Manim render timed out after 300 seconds",
            },
        )
    except Exception as exc:
        print(
            f"[job] failed jobId={job_id} reason=Exception error={exc}",
            flush=True,
        )
        print(traceback.format_exc(), flush=True)
        _send_callback(
            callback_url,
            callback_secret,
            {"jobId": job_id, "status": "failed", "error": str(exc)},
        )


@app.post("/render")
def render():
    expected_secret = os.getenv("RENDER_WORKER_SECRET")
    auth_header = request.headers.get("Authorization", "")
    if expected_secret and auth_header != f"Bearer {expected_secret}":
        return jsonify({"error": "Unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    print("[http] /render request received", flush=True)
    job_id = body.get("jobId")
    python_code = body.get("pythonCode")
    callback_url = body.get("callbackUrl")
    callback_secret = body.get("callbackSecret")
    blob_token = body.get("blobToken")

    if not job_id or not python_code or not callback_url or not callback_secret or not blob_token:
        print("[http] /render missing required fields", flush=True)
        return jsonify({"error": "Missing required fields"}), 400

    print(f"[http] /render accepted jobId={job_id}", flush=True)
    threading.Thread(
        target=_render_job,
        args=(job_id, python_code, callback_url, callback_secret, blob_token),
        daemon=True,
    ).start()

    return jsonify({"ok": True}), 202


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
