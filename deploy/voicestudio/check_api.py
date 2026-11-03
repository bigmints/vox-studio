"""Run on GX10; use the private deployment key without printing it."""
import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("path")
parser.add_argument("--body", help="JSON request body; selects POST")
parser.add_argument("--output", help="Write response bytes to this file")
args = parser.parse_args()
env = Path.home() / "services/voicestudio/.env"
key = next(line.split("=", 1)[1] for line in env.read_text().splitlines()
           if line.startswith("OMNIVOICE_API_KEY="))
data = json.dumps(json.loads(args.body)).encode() if args.body else None
req = urllib.request.Request("http://127.0.0.1:3900" + args.path, data=data,
                             headers={"Authorization": "Bearer " + key,
                                      "Content-Type": "application/json"})
started = time.monotonic()
try:
    with urllib.request.urlopen(req, timeout=1800) as response:
        content = response.read()
        print(json.dumps({"status": response.status,
                          "content_type": response.headers.get("Content-Type"),
                          "bytes": len(content),
                          "elapsed_seconds": round(time.monotonic() - started, 2)}))
        if args.output:
            Path(args.output).write_bytes(content)
        else:
            print(content.decode())
except urllib.error.HTTPError as error:
    print("HTTP", error.code, error.read().decode())
    raise SystemExit(1)
