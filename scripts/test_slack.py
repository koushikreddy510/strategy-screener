#!/usr/bin/env python3
"""
Send a test message to Slack. Run from project root:
  python scripts/test_slack.py

Requires SLACK_WEBHOOK_URL in .env or as env var.
"""
import os
import sys

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
if not webhook:
    print("ERROR: SLACK_WEBHOOK_URL not set. Add it to .env or export it.")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. pip install requests")
    sys.exit(1)

msg = (
    "*Test from Strategy Screener*\n"
    "If you see this, Slack webhook is working. You can safely rotate the webhook URL in .env."
)

try:
    r = requests.post(webhook, json={"text": msg}, timeout=15)
    if r.status_code == 200:
        print("✓ Message sent to Slack successfully")
    else:
        print(f"✗ Slack returned {r.status_code}: {r.text}")
        sys.exit(1)
except Exception as e:
    print(f"✗ Failed to send: {e}")
    sys.exit(1)
