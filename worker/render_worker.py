import base64
import os
import re
import subprocess
import tempfile
import threading
from pathlib import Path

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)


def _send_callback(callback_url: str, callback_secret: str, payload: dict):
    requests.post(
        callback_url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {callback_secret}",
        },
        timeout=60,
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


def _render_job(job_id: str, python_code: str, callback_url: str, callback_secret: str):
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

            command = [
                "manim",
                "-qm",
                str(script_path),
                scene_name,
                "--media_dir",
                str(media_dir),
                "--output_file",
                f"{job_id}.mp4",
            ]
            subprocess.run(command, check=True, capture_output=True, text=True)

            output_video = _find_rendered_video(media_dir)
            encoded_video = base64.b64encode(output_video.read_bytes()).decode("utf-8")

            _send_callback(
                callback_url,
                callback_secret,
                {
                    "jobId": job_id,
                    "status": "completed",
                    "videoBase64": encoded_video,
                },
            )
    except Exception as exc:
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
    job_id = body.get("jobId")
    python_code = body.get("pythonCode")
    callback_url = body.get("callbackUrl")
    callback_secret = body.get("callbackSecret")

    if not job_id or not python_code or not callback_url or not callback_secret:
        return jsonify({"error": "Missing required fields"}), 400

    threading.Thread(
        target=_render_job,
        args=(job_id, python_code, callback_url, callback_secret),
        daemon=True,
    ).start()

    return jsonify({"ok": True}), 202


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
