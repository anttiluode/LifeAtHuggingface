"""Exercise the real web server without downloading models or allocating a GPU."""
import base64
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
from PIL import Image
import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    # Observe the same Gradio server-start boundary used by ZeroGPU. Keep the
    # real launch/server implementation; only the expensive models are mocked.
    bootstrap = """
import runpy
from gradio import http_server
original = http_server.start_server
def observed_start(*args, **kwargs):
    print('GRADIO_SERVER_START_HOOK', flush=True)
    return original(*args, **kwargs)
http_server.start_server = observed_start
runpy.run_path('app.py', run_name='__main__')
"""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ, LIFE2_MOCK="1", GRADIO_SERVER_PORT=str(port),
               GRADIO_SSR_MODE="true", GRADIO_ANALYTICS_ENABLED="false")
    env.pop("SPACES_ZERO_GPU", None)
    log_path = tmp_path_factory.mktemp("server") / "startup.log"
    with log_path.open("w") as log:
        process = subprocess.Popen([sys.executable, "-u", "-c", bootstrap],
                                   cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=15,
                              trust_env=False) as client:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        pytest.fail(log_path.read_text())
                    try:
                        if client.get("/space-config").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.1)
                else:
                    pytest.fail("Server did not start:\n" + log_path.read_text())
                yield client, log_path
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def test_startup_reaches_gradio_server_hook(server):
    _, log_path = server
    assert "GRADIO_SERVER_START_HOOK" in log_path.read_text(), (
        "Startup bypassed Gradio's server hook used by ZeroGPU registration"
    )


def test_game_routes_and_gradio_config_coexist(server):
    client, _ = server
    assert client.get("/").content == (ROOT / "game/index.html").read_bytes()
    for name in ("ai.js", "app.js", "engine.js", "history.js", "style.css"):
        assert client.get("/" + name).content == (ROOT / "game" / name).read_bytes()
    assert client.get("/space-config").json()["space"] is True
    config = client.get("/config").json()
    assert {"narrate", "paint"} <= {d["api_name"] for d in config["dependencies"]}


def call(client, name, data):
    response = client.post(f"/gradio_api/call/{name}", json={"data": data})
    response.raise_for_status()
    event_id = response.json()["event_id"]
    result = client.get(f"/gradio_api/call/{name}/{event_id}")
    result.raise_for_status()
    return result.text


def test_narration_streams_through_game_api(server):
    client, _ = server
    stream = call(client, "narrate", [json.dumps({"year": 1901}), "[]", 1])
    assert "event: generating" in stream
    assert "event: complete" in stream
    assert "The stove ticks as it cools." in stream


def test_painter_returns_image_through_game_api(server):
    client, _ = server
    stream = call(client, "paint", ["a family in a small house", 1])
    assert "event: complete" in stream, stream
    payload = stream.split("event: complete\n", 1)[1].split("data: ", 1)[1].split("\n", 1)[0]
    data_url = json.loads(payload)[0]
    assert data_url.startswith("data:image/jpeg;base64,")
    img = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
    assert img.size == (576, 384)
