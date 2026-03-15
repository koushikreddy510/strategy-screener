"""
Daily AI Screener Report: Run all strategies, collect passed stocks, top 10 per sector,
run AI analysis (best sector, best stocks), post to Slack.
Requires: OPENAI_API_KEY, SLACK_WEBHOOK_URL in .env
"""
import os
from datetime import date
from typing import Dict, Any, List, Optional
from collections import defaultdict

from sector_groups import get_parent_sector, PARENT_SECTORS
from screener_engine import run_strategy_for_api
from financials_engine import get_financials_for_symbols, get_cagr_for_symbols


def _normalize_symbol(s: str) -> str:
    return (s or "").replace("NSE:", "").replace("-EQ", "")


def collect_all_matches(db_session) -> Dict[str, Any]:
    """
    Run all active stock strategies and collect unique matches.
    Returns: {
        all_matches: [{symbol, sector, parent_sector, market_cap, close, strategy_names, ...}],
        by_strategy: {strategy_name: [symbols]},
        by_sector: {parent_sector: [matches]},
    }
    """
    from backend.crud import get_strategies

    strategies = [s for s in get_strategies(db_session, market_type="stocks", limit=100) if s.is_active]
    if not strategies:
        return {"all_matches": [], "by_strategy": {}, "by_sector": {}, "strategies_run": []}

    symbol_to_match: Dict[str, dict] = {}
    by_strategy: Dict[str, List[str]] = {}

    for strat in strategies:
        result = run_strategy_for_api(
            strat.id, None, 1, 9999,
            market_type="stocks", timeframe=strat.timeframe or "1D",
            matched_only=True,
        )
        matches = [m for m in result["matches"] if m.get("matched")]
        syms = []
        for m in matches:
            sym = m.get("symbol", "")
            if not sym:
                continue
            parent = get_parent_sector(m.get("sector", ""))
            if parent == "Others" or not parent:
                parent = "Services & Others"
            if sym not in symbol_to_match:
                symbol_to_match[sym] = {
                    "symbol": sym,
                    "symbol_short": _normalize_symbol(sym),
                    "sector": m.get("sector", ""),
                    "parent_sector": parent,
                    "market_cap": m.get("market_cap", 0) or 0,
                    "close": m.get("close", 0) or 0,
                    "market_cap_category": m.get("market_cap_category", ""),
                    "company_name": m.get("company_name", ""),
                    "strategy_names": [],
                }
            entry = symbol_to_match[sym]
            if strat.name not in entry["strategy_names"]:
                entry["strategy_names"].append(strat.name)
            syms.append(sym)
        by_strategy[strat.name] = syms

    all_matches = list(symbol_to_match.values())
    by_sector = defaultdict(list)
    for m in all_matches:
        by_sector[m["parent_sector"]].append(m)

    return {
        "all_matches": all_matches,
        "by_strategy": by_strategy,
        "by_sector": dict(by_sector),
        "symbol_to_match": symbol_to_match,
        "strategies_run": [s.name for s in strategies],
    }


CAP_ORDER = ("Large Cap", "Mid Cap", "Small Cap", "Micro Cap", "Unknown")


def _top_per_cap_segment(stocks: List[dict], n_per_segment: int = 10) -> List[dict]:
    """
    Take top N from each cap segment (Large/Mid/Small/Micro) so small caps aren't
    crowded out by large caps. Returns combined list ordered by cap tier.
    """
    from collections import defaultdict
    by_cap: Dict[str, List[dict]] = defaultdict(list)
    for s in stocks:
        cap = s.get("market_cap_category") or "Unknown"
        by_cap[cap].append(s)
    out = []
    for cap in CAP_ORDER:
        seg = by_cap.get(cap, [])
        sorted_seg = sorted(seg, key=lambda x: (x.get("market_cap") or 0), reverse=True)
        out.extend(sorted_seg[:n_per_segment])
    return out


def get_top10_per_sector(by_sector: Dict[str, List[dict]], n_per_segment: int = 10) -> Dict[str, List[dict]]:
    """Top N per cap segment (Large/Mid/Small/Micro) per sector, so we see variety across caps."""
    top = {}
    for sector, stocks in by_sector.items():
        top[sector] = _top_per_cap_segment(stocks, n_per_segment)
    return top


def get_top10_per_strategy(
    by_strategy: Dict[str, List[str]],
    symbol_to_match: Dict[str, dict],
    n_per_segment: int = 10,
) -> Dict[str, List[dict]]:
    """Top N per cap segment per strategy, so small caps appear alongside large caps."""
    top = {}
    for strat_name, syms in by_strategy.items():
        matches = [symbol_to_match[s] for s in syms if s in symbol_to_match]
        top[strat_name] = _top_per_cap_segment(matches, n_per_segment)
    return top


def build_ai_prompt(
    all_matches: List[dict],
    top10_per_sector: Dict[str, List[dict]],
    top10_per_strategy: Dict[str, List[dict]],
    financials_map: Dict[str, dict],
    cagr_map: Dict[str, dict],
    today_str: str,
) -> str:
    """Build a comprehensive prompt for AI analysis."""

    def _row(m, include_fin=True):
        sym = m.get("symbol_short", _normalize_symbol(m.get("symbol", "")))
        f = financials_map.get(m.get("symbol", ""), {})
        c = cagr_map.get(m.get("symbol", ""), {})
        parts = [
            sym,
            m.get("parent_sector", "-"),
            m.get("market_cap_category", "-"),
            str(round(m.get("close", 0), 2)),
        ]
        if include_fin:
            if f.get("revenue"):
                parts.append(f"Rev:{f['revenue']:.0f}Cr")
            if f.get("pe_ratio"):
                parts.append(f"P/E:{f['pe_ratio']:.1f}")
            if f.get("roce_pct"):
                parts.append(f"ROCE:{f['roce_pct']}%")
            if c.get("revenue_cagr_pct"):
                parts.append(f"RevCAGR:{c['revenue_cagr_pct']}%")
        return " | ".join(str(p) for p in parts)

    all_text = "\n".join(_row(m) for m in all_matches[:200])  # Cap to avoid token limit
    if len(all_matches) > 200:
        all_text += f"\n... and {len(all_matches) - 200} more (truncated)"

    top10_sector_lines = []
    for sector in PARENT_SECTORS:
        stocks = top10_per_sector.get(sector, [])
        if not stocks:
            continue
        lines = [f"  {_row(s)}" for s in stocks]
        top10_sector_lines.append(f"*{sector}*:\n" + "\n".join(lines))
    top10_sector_text = "\n\n".join(top10_sector_lines) if top10_sector_lines else "None"

    top10_strategy_lines = []
    for strat_name, stocks in top10_per_strategy.items():
        if not stocks:
            continue
        lines = [f"  {_row(s)}" for s in stocks]
        top10_strategy_lines.append(f"*{strat_name}*:\n" + "\n".join(lines))
    top10_strategy_text = "\n\n".join(top10_strategy_lines) if top10_strategy_lines else "None"

    prompt = f"""You are an equity research analyst for Indian (NSE) markets. Today is {today_str}.

Below are stocks that passed one or more technical screening strategies. Provide an in-depth analysis.

**Context to consider:**
- **Financials**: Revenue, P/E, ROCE, debt/equity, growth (CAGR), margins
- **Themes**: Sector rotation, domestic consumption vs export, capex vs consumption, renewables, defence indigenisation
- **Government schemes**: PLI, infra push, housing schemes, renewable incentives
- **Sector dynamics**: Relative strength, valuation vs peers, earnings visibility
- **Global**: US Fed rates, commodity prices, geopolitical risks

**Required output (in order):**

1. **Sector analysis** (2-3 paras): Which sectors look most favourable and why? Compare valuations, growth, themes. Highlight sector-specific risks.

2. **Theme-oriented view**: Identify 2-3 investable themes (e.g. capex cycle, domestic consumption, defence) and which stocks/sectors align.

3. **Financial quality screen**: From the data, which stocks stand out on P/E, ROCE, revenue growth? Any value traps or overvalued names to avoid?

4. **Top 5-8 stock picks**: Symbol, 2-3 line rationale (financial + thematic), key risk. Pick across sectors/themes.

5. **Caveats**: Macro or sector risks to watch.

Respond in clear markdown. No preamble.

---
ALL PASSED STOCKS (symbol | sector | cap | close | Rev Cr | P/E | ROCE | RevCAGR):
{all_text}

---
TOP 10 PER SECTOR (10 each from Large/Mid/Small/Micro cap):
{top10_sector_text}

---
TOP 10 PER STRATEGY (10 each from Large/Mid/Small/Micro cap):
{top10_strategy_text}
"""
    return prompt


def run_ai_analysis(prompt: str) -> Optional[str]:
    """Call OpenAI and return the model's response."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=3500,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return None


def _row_with_fin(m, financials_map: Dict, cagr_map: Dict) -> str:
    """Format a stock row with financial data for display."""
    f = financials_map.get(m.get("symbol", ""), {})
    c = cagr_map.get(m.get("symbol", ""), {})
    parts = [
        _normalize_symbol(m.get("symbol", "")),
        m.get("parent_sector", "-"),
        m.get("market_cap_category", "-"),
        str(round(m.get("close", 0), 2)),
    ]
    if f.get("revenue"):
        parts.append(f"Rev:{f['revenue']:.0f}Cr")
    if f.get("pe_ratio"):
        parts.append(f"P/E:{f['pe_ratio']:.1f}")
    if f.get("roce_pct"):
        parts.append(f"ROCE:{f['roce_pct']}%")
    if c.get("revenue_cagr_pct"):
        parts.append(f"CAGR:{c['revenue_cagr_pct']}%")
    return " | ".join(str(p) for p in parts)


def post_to_slack(
    all_matches: List[dict],
    top10_per_sector: Dict[str, List[dict]],
    top10_per_strategy: Dict[str, List[dict]],
    financials_map: Dict[str, dict],
    cagr_map: Dict[str, dict],
    ai_output: Optional[str],
    prompt_used: str,
    strategies_run: List[str],
    today_str: str,
) -> bool:
    """Post formatted report to Slack. Returns True on success."""
    webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        return False

    import requests

    # Build summary section
    total = len(all_matches)
    sector_counts = defaultdict(int)
    for m in all_matches:
        sector_counts[m.get("parent_sector", "Others")] += 1

    summary_lines = [
        f"*Daily AI Screener Report — {today_str}*",
        f"Strategies run: {', '.join(strategies_run) or 'None'}",
        f"Total unique stocks passed: *{total}*",
        f"By sector: " + ", ".join(f"{s}: {c}" for s, c in sorted(sector_counts.items(), key=lambda x: -x[1])[:10]),
    ]
    summary_block = "\n".join(summary_lines)

    # Top 10 per STRATEGY (10 each from Large/Mid/Small/Micro)
    strat_block_lines = ["*Top per strategy (10 each from Large/Mid/Small/Micro cap):*"]
    for strat_name, stocks in top10_per_strategy.items():
        if not stocks:
            continue
        strat_block_lines.append(f"• *{strat_name}*:")
        for s in stocks[:10]:
            strat_block_lines.append(f"  {_row_with_fin(s, financials_map, cagr_map)}")
    strat_block = "\n".join(strat_block_lines) if len(strat_block_lines) > 1 else "No strategy data"

    # Top 10 per sector
    top_block_lines = ["*Top per sector (10 each from Large/Mid/Small/Micro cap):*"]
    for sector in PARENT_SECTORS:
        stocks = top10_per_sector.get(sector, [])
        if not stocks:
            continue
        top_block_lines.append(f"• *{sector}*:")
        for s in stocks[:10]:
            top_block_lines.append(f"  {_row_with_fin(s, financials_map, cagr_map)}")
    top_block = "\n".join(top_block_lines) if len(top_block_lines) > 1 else "No sector data"

    # All passed stocks (truncated)
    fin_lines = ["*All passed stocks (symbol | sector | cap | close | Rev | P/E | ROCE | CAGR):*"]
    for m in all_matches[:60]:  # Reduced to make room for strategy block
        fin_lines.append(_row_with_fin(m, financials_map, cagr_map))
    if len(all_matches) > 60:
        fin_lines.append(f"... and {len(all_matches) - 60} more")
    fin_block = "\n".join(fin_lines)

    # AI output
    ai_block = f"*AI Analysis:*\n{ai_output}" if ai_output else "*AI Analysis:* (OpenAI API key not set or error)"

    # Prompt preview
    prompt_preview = f"*Prompt preview (first 400 chars):*\n```\n{prompt_used[:400]}{'...' if len(prompt_used) > 400 else ''}\n```"

    # Slack ~40KB limit; order: summary, top per strategy, top per sector, AI, prompt
    full_text = f"{summary_block}\n\n{strat_block}\n\n{top_block}\n\n{ai_block}\n\n{prompt_preview}"
    if len(full_text) > 38000:
        full_text = f"{summary_block}\n\n{strat_block}\n\n{top_block}\n\n{ai_block[:30000]}... [truncated]"

    payload = {"text": full_text}
    try:
        r = requests.post(webhook, json=payload, timeout=15)
        return r.status_code == 200
    except Exception:
        return False


def run_daily_report(db_session) -> Dict[str, Any]:
    """
    Main entry: collect matches, top 10 per sector, run AI, post to Slack.
    Returns summary dict for API response.
    """
    today_str = date.today().isoformat()
    collected = collect_all_matches(db_session)
    all_matches = collected["all_matches"]
    by_sector = collected["by_sector"]
    strategies_run = collected.get("strategies_run", [])

    if not all_matches:
        # Still post to Slack so user knows the job ran
        try:
            post_to_slack(
                [], {}, {}, {}, {},
                "No stocks passed any strategy today.",
                "(Prompt not run - no matches)",
                strategies_run, today_str,
            )
        except Exception:
            pass
        return {
            "ok": False,
            "error": "No stocks passed any strategy. Posted 'no matches' to Slack.",
            "strategies_run": strategies_run,
            "total_matches": 0,
            "slack_posted": True,
        }

    top10_sector = get_top10_per_sector(by_sector, n_per_segment=10)
    symbol_to_match = collected.get("symbol_to_match", {})
    sym_from_matches = {m["symbol"]: m for m in all_matches}
    if not symbol_to_match:
        symbol_to_match = sym_from_matches
    top10_strategy = get_top10_per_strategy(collected.get("by_strategy", {}), symbol_to_match, n_per_segment=10)

    symbols = [m["symbol"] for m in all_matches]
    financials_map = get_financials_for_symbols(symbols, result_type="quarterly")
    cagr_map = get_cagr_for_symbols(symbols, years=3)

    prompt = build_ai_prompt(all_matches, top10_sector, top10_strategy, financials_map, cagr_map, today_str)
    ai_output = run_ai_analysis(prompt)
    slack_ok = post_to_slack(
        all_matches, top10_sector, top10_strategy, financials_map, cagr_map,
        ai_output, prompt, strategies_run, today_str,
    )

    return {
        "ok": True,
        "slack_posted": slack_ok,
        "total_matches": len(all_matches),
        "strategies_run": strategies_run,
        "sectors_with_matches": len(by_sector),
        "ai_analyzed": ai_output is not None,
        "ai_output_preview": (ai_output[:500] + "...") if ai_output and len(ai_output) > 500 else ai_output,
    }
