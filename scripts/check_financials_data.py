#!/usr/bin/env python3
"""
Check stock_financials table: row count, schema, sample data, and tradingsymbol format.
Run from project root: python scripts/check_financials_data.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Set DATABASE_URL environment variable")
    sys.exit(1)

from sqlalchemy import create_engine, text

engine = create_engine(DATABASE_URL)

def main():
    with engine.connect() as conn:
        # 1. Table exists?
        try:
            r = conn.execute(text("SELECT COUNT(*) FROM stock_financials")).scalar()
        except Exception as e:
            print(f"ERROR: stock_financials table: {e}")
            return 1

        print(f"stock_financials: {r} total rows")

        # 2. Distinct symbols
        sym_count = conn.execute(text("SELECT COUNT(DISTINCT tradingsymbol) FROM stock_financials")).scalar()
        print(f"Distinct tradingsymbols: {sym_count}")

        # 3. Sample tradingsymbols (format check)
        samples = conn.execute(text("""
            SELECT DISTINCT tradingsymbol FROM stock_financials LIMIT 5
        """)).fetchall()
        print("\nSample tradingsymbols:", [r[0] for r in samples])

        # 4. Sample row with key columns
        if r > 0:
            row = conn.execute(text("""
                SELECT tradingsymbol, revenue, operating_profit, opm_pct, net_profit,
                       pe_ratio, pb_ratio, roce_pct, roe_pct,
                       revenue_growth_pct, profit_growth_pct
                FROM stock_financials
                WHERE result_type = 'quarterly'
                ORDER BY period_end_date DESC NULLS LAST
                LIMIT 1
            """)).fetchone()
            print("\nSample row (latest quarterly):")
            print("  tradingsymbol:", row[0])
            print("  revenue:", row[1])
            print("  operating_profit:", row[2])
            print("  opm_pct:", row[3])
            print("  net_profit:", row[4])
            print("  pe_ratio:", row[5])
            print("  pb_ratio:", row[6])
            print("  roce_pct:", row[7])
            print("  roe_pct:", row[8])
            print("  revenue_growth_pct:", row[9])
            print("  profit_growth_pct:", row[10])

        # 5. Symbols in run results vs stock_financials
        print("\n--- Format check: symbols table vs stock_financials ---")
        sym_in_both = conn.execute(text("""
            SELECT s.tradingsymbol FROM symbols s
            INNER JOIN stock_financials f ON f.tradingsymbol = s.tradingsymbol
            WHERE s.tradingsymbol LIKE '%-EQ'
            LIMIT 3
        """)).fetchall()
        print("Symbols in BOTH symbols + stock_financials:", [r[0] for r in sym_in_both])

        # 6. schema - does source column exist?
        cols = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'stock_financials' ORDER BY ordinal_position
        """)).fetchall()
        print("\nColumns in stock_financials:", [c[0] for c in cols])

    return 0

if __name__ == "__main__":
    sys.exit(main())
