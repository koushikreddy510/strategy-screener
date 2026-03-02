#!/usr/bin/env python3
"""
Check sector (and optional sub_sector) coverage for stocks in the symbols table.
Run locally with DATABASE_URL pointing to prod to verify prod has sectors populated.

Usage:
  # Local DB (default from .env or DATABASE_URL)
  python scripts/check_sector_coverage.py

  # Prod DB (run from your machine)
  DATABASE_URL="postgresql://market_user:market_pass@210.79.129.135:5432/market" python scripts/check_sector_coverage.py
"""
import os
import sys

def main():
    try:
        from sqlalchemy import create_engine, text
    except ImportError:
        print("Install: pip install sqlalchemy psycopg2-binary")
        sys.exit(1)

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("Set DATABASE_URL (e.g. postgresql://user:pass@host:5432/market)")
        sys.exit(1)

    engine = create_engine(db_url)
    with engine.connect() as conn:
        # Total NSE-EQ symbols
        total = conn.execute(text("""
            SELECT COUNT(*) FROM symbols WHERE tradingsymbol LIKE '%-EQ'
        """)).scalar()

        # With non-empty sector
        with_sector = conn.execute(text("""
            SELECT COUNT(*) FROM symbols
            WHERE tradingsymbol LIKE '%-EQ' AND COALESCE(TRIM(sector), '') != ''
        """)).scalar()

        # Check if sub_sector column exists
        has_sub_sector = conn.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'symbols' AND column_name = 'sub_sector'
            )
        """)).scalar()

        with_sub = 0
        if has_sub_sector:
            with_sub = conn.execute(text("""
                SELECT COUNT(*) FROM symbols
                WHERE tradingsymbol LIKE '%-EQ' AND COALESCE(TRIM(sub_sector), '') != ''
            """)).scalar()

        # Distinct sectors and counts
        sectors = conn.execute(text("""
            SELECT COALESCE(NULLIF(TRIM(sector), ''), '(empty)') AS sec, COUNT(*) AS cnt
            FROM symbols WHERE tradingsymbol LIKE '%-EQ'
            GROUP BY 1 ORDER BY cnt DESC
        """)).fetchall()

    pct = (100 * with_sector / total) if total else 0
    pct_sub = (100 * with_sub / total) if total and has_sub_sector else 0

    print("=== Sector coverage ===\n")
    print(f"Total NSE-EQ symbols: {total}")
    print(f"With sector:         {with_sector} ({pct:.1f}%)")
    if has_sub_sector:
        print(f"With sub_sector:     {with_sub} ({pct_sub:.1f}%)")
    else:
        print("sub_sector column:   not present (only sector is used)")

    if with_sector < total and total > 0:
        print("\nTo fill sectors on this DB, run the data-store enrich script against it:")
        print("  cd /path/to/data-store && DATABASE_URL='...' python enrich_market_cap.py")
        print("  (Uses NSE API; rate-limited.)")

    print("\n--- Sectors (top 30) ---")
    for sec, cnt in sectors[:30]:
        print(f"  {cnt:5d}  {sec}")
    if len(sectors) > 30:
        print(f"  ... and {len(sectors) - 30} more")

if __name__ == "__main__":
    main()
