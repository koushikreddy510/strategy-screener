"""
Automated Fyers API token generation using TOTP (no browser needed).

Required env vars:
  FYERS_CLIENT_ID      - App ID from Fyers developer portal
  FYERS_SECRET_KEY     - App Secret
  FYERS_REDIRECT_URI   - Must match the app config (e.g. "https://www.google.com/")
  FYERS_USERNAME       - Fyers client ID (e.g. "XK12345")
  FYERS_PIN            - 4-digit login PIN
  FYERS_TOTP_KEY       - TOTP secret key from Fyers authenticator setup

To get FYERS_TOTP_KEY:
  1. Go to Fyers My Account -> Security -> Enable 2FA with Authenticator App
  2. When you see the QR code, click "Can't scan?" to reveal the secret key
  3. That secret key is your FYERS_TOTP_KEY
"""

import os
import base64
import hmac
import struct
import time
import hashlib
from urllib.parse import urlparse, parse_qs
from typing import Optional

import requests

TOKEN_FILE = os.getenv("FYERS_TOKEN_FILE", os.path.join(
    os.path.dirname(__file__), "..", "data-store", "fyers_access_token.txt"
))


def generate_totp(key: str, time_step: int = 30, digits: int = 6) -> str:
    key_bytes = base64.b32decode(key.upper() + "=" * ((8 - len(key)) % 8))
    counter = struct.pack(">Q", int(time.time() / time_step))
    mac = hmac.new(key_bytes, counter, "sha1").digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">L", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary)[-digits:].zfill(digits)


def generate_fyers_token(
    client_id: Optional[str] = None,
    secret_key: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    username: Optional[str] = None,
    pin: Optional[str] = None,
    totp_key: Optional[str] = None,
) -> dict:
    """
    Fully automated Fyers token generation. Returns {"access_token": "...", "status": "ok"}
    or {"error": "...", "status": "failed"}.
    """
    client_id = client_id or os.getenv("FYERS_CLIENT_ID")
    secret_key = secret_key or os.getenv("FYERS_SECRET_KEY")
    redirect_uri = redirect_uri or os.getenv("FYERS_REDIRECT_URI", "https://www.google.com/")
    username = username or os.getenv("FYERS_USERNAME")
    pin = pin or os.getenv("FYERS_PIN")
    totp_key = totp_key or os.getenv("FYERS_TOTP_KEY")

    if not all([client_id, secret_key, redirect_uri, username, pin, totp_key]):
        missing = []
        if not client_id: missing.append("FYERS_CLIENT_ID")
        if not secret_key: missing.append("FYERS_SECRET_KEY")
        if not username: missing.append("FYERS_USERNAME")
        if not pin: missing.append("FYERS_PIN")
        if not totp_key: missing.append("FYERS_TOTP_KEY")
        return {"status": "failed", "error": f"Missing env vars: {', '.join(missing)}"}

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }

    s = requests.Session()
    s.headers.update(headers)

    try:
        # Step 1: Send login OTP
        fy_id_b64 = base64.b64encode(username.encode()).decode()
        r1 = s.post("https://api-t2.fyers.in/vagator/v2/send_login_otp_v2",
                     json={"fy_id": fy_id_b64, "app_id": "2"})
        if r1.status_code != 200 or "request_key" not in r1.json():
            return {"status": "failed", "error": f"Step 1 failed: {r1.text}"}
        request_key = r1.json()["request_key"]

        # Step 2: Verify TOTP (wait if near end of 30s window to avoid expiry mid-request)
        if int(time.time()) % 30 > 27:
            time.sleep(4)
        otp = generate_totp(totp_key)
        r2 = s.post("https://api-t2.fyers.in/vagator/v2/verify_otp",
                     json={"request_key": request_key, "otp": int(otp)})
        if r2.status_code != 200 or "request_key" not in r2.json():
            return {"status": "failed", "error": f"Step 2 (TOTP verify) failed: {r2.text}"}
        request_key = r2.json()["request_key"]

        # Step 3: Verify PIN
        pin_b64 = base64.b64encode(str(pin).encode()).decode()
        r3 = s.post("https://api-t2.fyers.in/vagator/v2/verify_pin_v2",
                     json={"request_key": request_key, "identity_type": "pin", "identifier": pin_b64})
        if r3.status_code != 200:
            return {"status": "failed", "error": f"Step 3 (PIN verify) failed: {r3.text}"}
        bearer_token = r3.json().get("data", {}).get("access_token")
        if not bearer_token:
            return {"status": "failed", "error": f"Step 3 no access_token: {r3.text}"}

        # Step 4: Get auth code (v3 endpoint)
        app_id_without_suffix = client_id[:-4] if client_id.endswith("-100") else client_id
        s.headers.update({"authorization": f"Bearer {bearer_token}"})
        r4 = s.post("https://api-t1.fyers.in/api/v3/token", json={
            "fyers_id": username,
            "app_id": app_id_without_suffix,
            "redirect_uri": redirect_uri,
            "appType": "100",
            "code_challenge": "",
            "state": "None",
            "scope": "",
            "nonce": "",
            "response_type": "code",
            "create_cookie": True,
        })
        r4_json = r4.json()
        auth_url = r4_json.get("Url", "")
        if not auth_url:
            return {"status": "failed", "error": f"Step 4 (auth code) failed (status {r4.status_code}): {r4.text}"}

        parsed = urlparse(auth_url)
        qs = parse_qs(parsed.query)
        if "auth_code" not in qs:
            return {"status": "failed", "error": f"No auth_code in redirect URL: {auth_url}"}
        auth_code = qs["auth_code"][0]

        # Step 5: Exchange auth code for access token
        session_model = None
        try:
            from fyers_apiv3 import fyersModel
            session_model = fyersModel.SessionModel(
                client_id=client_id,
                secret_key=secret_key,
                redirect_uri=redirect_uri,
                response_type="code",
                grant_type="authorization_code",
            )
            session_model.set_token(auth_code)
            response = session_model.generate_token()
            if "access_token" not in response:
                return {"status": "failed", "error": f"Step 5 (token exchange) failed: {response}"}
            access_token_value = response["access_token"]
        except ImportError:
            app_id_hash = hashlib.sha256(f"{client_id}:{secret_key}".encode()).hexdigest()
            r5 = requests.post("https://api-t1.fyers.in/api/v3/validate-authcode", json={
                "grant_type": "authorization_code",
                "appIdHash": app_id_hash,
                "code": auth_code,
            })
            if "access_token" not in r5.json():
                return {"status": "failed", "error": f"Step 5 (token exchange) failed: {r5.text}"}
            access_token_value = r5.json()["access_token"]

        # Save token
        try:
            token_dir = os.path.dirname(TOKEN_FILE)
            if token_dir:
                os.makedirs(token_dir, exist_ok=True)
            with open(TOKEN_FILE, "w") as f:
                f.write(access_token_value)
        except Exception:
            pass

        return {"status": "ok", "access_token": access_token_value[:20] + "...", "saved_to": TOKEN_FILE}

    except Exception as e:
        return {"status": "failed", "error": str(e)}


def validate_current_token() -> dict:
    """Check if the current saved token is still valid."""
    try:
        from fyers_apiv3 import fyersModel
    except ImportError:
        return {"valid": False, "error": "fyers_apiv3 not installed"}

    if not os.path.exists(TOKEN_FILE):
        return {"valid": False, "error": f"Token file not found: {TOKEN_FILE}"}

    with open(TOKEN_FILE) as f:
        token = f.read().strip()
    if not token:
        return {"valid": False, "error": "Token file is empty"}

    client_id = os.getenv("FYERS_CLIENT_ID")
    fyers = fyersModel.FyersModel(client_id=client_id, token=token, log_path=None)
    try:
        prof = fyers.get_profile()
        if prof and prof.get("s") == "ok":
            return {"valid": True, "profile": prof.get("data", {})}
        return {"valid": False, "error": f"Profile check failed: {prof}"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


if __name__ == "__main__":
    result = generate_fyers_token()
    if result["status"] == "ok":
        print(f"Token generated and saved to {result['saved_to']}")
    else:
        print(f"Failed: {result['error']}")
