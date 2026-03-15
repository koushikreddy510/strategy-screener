#!/usr/bin/env python3
"""
Test if Fyers history API returns OHLC for NSE index symbols.

Indices are NOT in Fyers NSE_CM.csv (equity only) or NSE_FO.csv (F&O only).
This script tests if the history API accepts common index symbol formats.

Run: python scripts/test_fyers_index_symbols.py
Requires: FYERS_TOKEN_FILE env or token at data/.fyers_access_token.txt
"""
import os
import sys
from datetime import date, timedelta

# Add project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Index symbols to try (various formats reported in Fyers community)
INDEX_SYMBOLS_TO_TEST = [
    "NSE:NIFTY50-INDEX",      # Nifty 50 - common format
    "NSE:NIFTY 50-INDEX",     # With space
    "NSE:BANKNIFTY-INDEX",    # Bank Nifty
    "NSE:NIFTY BANK-INDEX",
    "NSE:NIFTYIT-INDEX",      # Nifty IT
    "NSE:NIFTY IT-INDEX",
    "NSE:NIFTYPHARMA-INDEX",  # Nifty Pharma
    "NSE:NIFTY PHARMA-INDEX",
    "NSE:NIFTYFMCG-INDEX",
    "NSE:NIFTY AUTO-INDEX",
    "NSE:NIFTYMETAL-INDEX",
    "NSE:NIFTY REALTY-INDEX",
    "NSE:NIFTYENERGY-INDEX",
]


def main():
    root = os.path.dirname(os.path.dirname(__file__))
    token_file = os.getenv("FYERS_TOKEN_FILE")
    if not token_file:
        # Same paths as data_manager / fyers_token_manager
        for p in [
            os.path.join(root, "data-store", "fyers_access_token.txt"),
            os.path.join(root, "data", "fyers_access_token.txt"),
        ]:
            if os.path.exists(p):
                token_file = p
                break
        token_file = token_file or os.path.join(root, "data-store", "fyers_access_token.txt")
    if not os.path.exists(token_file):
        print(f"Token file not found. Tried: {token_file}")
        print("Set FYERS_TOKEN_FILE or ensure fyers_access_token.txt exists.")
        return 1

    with open(token_file) as f:
        token = f.read().strip()
    if not token:
        print("Token file is empty.")
        return 1

    client_id = os.getenv("FYERS_CLIENT_ID", "03VEQP97U0-100")

    try:
        from fyers_apiv3 import fyersModel
    except ImportError:
        print("pip install fyers-apiv3")
        return 1

    fyers = fyersModel.FyersModel(client_id=client_id, token=token, log_path=None)
    range_to = date.today().strftime("%Y-%m-%d")
    range_from = (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")

    print("Testing Fyers history API for index symbols...")
    print("=" * 60)

    working = []
    failed = []

    for symbol in INDEX_SYMBOLS_TO_TEST:
        try:
            resp = fyers.history(data={
                "symbol": symbol,
                "resolution": "1D",
                "date_format": "1",
                "range_from": range_from,
                "range_to": range_to,
                "cont_flag": "1",
            })
            status = resp.get("s", "?")
            msg = resp.get("message", "")
            candles = resp.get("candles", []) if isinstance(resp.get("candles"), list) else []

            if status == "ok" and candles:
                working.append((symbol, len(candles)))
                print(f"  OK: {symbol}  ->  {len(candles)} candles")
            else:
                failed.append((symbol, msg or status))
                err = msg or status
                print(f"  FAIL: {symbol}  ->  {err}")
        except Exception as e:
            failed.append((symbol, str(e)))
            print(f"  ERROR: {symbol}  ->  {e}")

    print("=" * 60)
    print(f"Working: {len(working)}  |  Failed: {len(failed)}")
    if working:
        print("\nUse these symbols for index OHLC sync:")
        for sym, n in working:
            print(f"  {sym}")
    return 0 if working else 1


if __name__ == "__main__":
    sys.exit(main())
