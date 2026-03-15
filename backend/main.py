from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from backend import crud, models, schemas
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from backend.database import SessionLocal, engine
from screener_engine import (
    run_strategy_for_api, load_ohlc,
    list_symbols, INDICATOR_METADATA, get_chart_data_with_indicators,
    invalidate_cache, get_sector_overview, scan_all_patterns, scan_structural_patterns, scan_52w_high_low,
)
from financials_engine import (
    get_financials_list, get_symbol_financials, get_financials_summary,
    get_latest_results, get_financials_for_symbols, get_cagr_for_symbols,
)
from sector_groups import get_parent_sector, PARENT_SECTORS
from data_manager import (
    get_data_status, sync_symbols, start_ohlcv_update,
    start_financials_update, start_sector_enrichment,
    start_latest_results_scrape, start_screener_latest_scrape,
    start_daily_ai_report, get_job_status, get_all_jobs,
)
from fyers_token_manager import generate_fyers_token, validate_current_token

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Strategy Screener", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Metadata ---

@app.get("/indicators/metadata")
def get_indicator_metadata():
    return {
        "indicators": INDICATOR_METADATA,
        "operators": [
            {"label": ">", "value": ">"},
            {"label": ">=", "value": ">="},
            {"label": "<", "value": "<"},
            {"label": "<=", "value": "<="},
            {"label": "==", "value": "=="},
            {"label": "crosses above", "value": "cross_above"},
            {"label": "crosses below", "value": "cross_below"},
        ],
        "threshold_types": [
            {"label": "Constant Value", "value": "value"},
            {"label": "OHLC Column", "value": "field"},
        ],
        "ohlc_columns": ["open", "high", "low", "close", "volume"],
        "market_types": [
            {"label": "Stocks (NSE)", "value": "stocks"},
            {"label": "Commodities (MCX)", "value": "commodities"},
        ],
        "timeframes": {
            "stocks": [{"label": "1 Day", "value": "1D"}, {"label": "1 Week", "value": "1W"}],
            "commodities": [
                {"label": "1 Day", "value": "1D"},
                {"label": "4 Hours", "value": "4H"},
                {"label": "2 Hours", "value": "2H"},
                {"label": "1 Hour", "value": "1H"},
            ],
        },
    }

# --- Strategy CRUD ---

@app.post("/strategies/", response_model=schemas.Strategy)
def create_strategy(strategy: schemas.StrategyCreateWithConditions, db: Session = Depends(get_db)):
    existing = db.query(models.Strategy).filter(models.Strategy.name == strategy.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Strategy with this name already exists")
    return crud.create_strategy(db, strategy)

@app.get("/strategies/", response_model=list[schemas.Strategy])
def read_strategies(
    skip: int = 0, limit: int = 100,
    market_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return crud.get_strategies(db, skip=skip, limit=limit, market_type=market_type)

@app.get("/strategies/{strategy_id}", response_model=schemas.Strategy)
def read_strategy(strategy_id: int, db: Session = Depends(get_db)):
    db_obj = crud.get_strategy(db, strategy_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return db_obj

@app.put("/strategies/{strategy_id}", response_model=schemas.Strategy)
def update_strategy(strategy_id: int, updates: schemas.StrategyUpdate, db: Session = Depends(get_db)):
    db_obj = crud.update_strategy(db, strategy_id, updates)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Strategy not found")
    invalidate_cache(strategy_id)
    return db_obj

@app.delete("/strategies/{strategy_id}", response_model=schemas.Strategy)
def delete_strategy(strategy_id: int, db: Session = Depends(get_db)):
    db_obj = crud.delete_strategy(db, strategy_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Strategy not found")
    invalidate_cache(strategy_id)
    return db_obj

# --- Conditions ---

@app.post("/strategies/{strategy_id}/conditions/", response_model=schemas.StrategyCondition)
def create_condition(strategy_id: int, condition: schemas.StrategyConditionCreate, db: Session = Depends(get_db)):
    if not crud.get_strategy(db, strategy_id):
        raise HTTPException(status_code=404, detail="Strategy not found")
    invalidate_cache(strategy_id)
    return crud.create_condition(db, strategy_id, condition)

@app.get("/strategies/{strategy_id}/conditions/", response_model=list[schemas.StrategyCondition])
def read_conditions(strategy_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    if not crud.get_strategy(db, strategy_id):
        raise HTTPException(status_code=404, detail="Strategy not found")
    return crud.get_conditions_for_strategy(db, strategy_id, skip, limit)

@app.get("/conditions/{condition_id}", response_model=schemas.StrategyCondition)
def read_condition(condition_id: int, db: Session = Depends(get_db)):
    db_obj = crud.get_condition(db, condition_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Condition not found")
    return db_obj

@app.put("/conditions/{condition_id}", response_model=schemas.StrategyCondition)
def update_condition(condition_id: int, updates: schemas.StrategyConditionUpdate, db: Session = Depends(get_db)):
    db_obj = crud.update_condition(db, condition_id, updates)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Condition not found")
    return db_obj

@app.delete("/conditions/{condition_id}", response_model=schemas.StrategyCondition)
def delete_condition(condition_id: int, db: Session = Depends(get_db)):
    db_obj = crud.delete_condition(db, condition_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Condition not found")
    return db_obj

# --- OHLC / Chart ---

@app.get("/ohlc/{symbol}")
def get_ohlc(symbol: str, market_type: str = "stocks", timeframe: str = "1D"):
    try:
        df = load_ohlc(symbol, market_type, timeframe)
        if df.empty:
            raise HTTPException(status_code=404, detail="Symbol not found")
        df = df.reset_index()
        dt_col = "date" if "date" in df.columns else "datetime"
        df[dt_col] = df[dt_col].astype(str)
        return df.to_dict(orient="records")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChartRequest(BaseModel):
    symbol: str
    market_type: str = "stocks"
    timeframe: str = "1D"
    indicators: List[Dict[str, Any]] = []
    limit: int = 200

@app.post("/chart")
def get_chart(req: ChartRequest):
    data = get_chart_data_with_indicators(
        symbol=req.symbol,
        market_type=req.market_type,
        timeframe=req.timeframe,
        indicator_configs=req.indicators,
        limit=req.limit,
    )
    if not data:
        raise HTTPException(status_code=404, detail="No data for symbol")
    return data

# --- Screener ---

@app.get("/run/{strategy_id}")
def run_strategy(
    strategy_id: int,
    scan_days: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=50),
    sort_by: Optional[str] = None,
    sort_dir: str = "desc",
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    matched_only: bool = True,
    db: Session = Depends(get_db),
):
    strategy = crud.get_strategy(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    result = run_strategy_for_api(
        strategy_id, scan_days, 1, 9999,
        market_type=strategy.market_type,
        timeframe=strategy.timeframe,
        matched_only=matched_only,
    )

    all_matches = list(result["matches"])
    total_scanned = result.get("total_scanned", len(all_matches))
    total_matched = result.get("total_matched", len(all_matches))

    all_sectors = sorted(set(m.get("sector", "") for m in all_matches if m.get("sector")))

    if cap_filter and cap_filter != "all":
        all_matches = [m for m in all_matches if m.get("market_cap_category", "").lower().replace(" ", "_") == cap_filter]

    if sector_filter and sector_filter != "all":
        if sector_filter in PARENT_SECTORS:
            all_matches = [m for m in all_matches if get_parent_sector(m.get("sector", "")) == sector_filter]
        else:
            all_matches = [m for m in all_matches if m.get("sector", "") == sector_filter]

    total = len(all_matches)
    include_financials = strategy.market_type == "stocks" and total >= 10

    # Enrich all matches with financials before sorting (so sort by revenue etc. works)
    if include_financials and all_matches:
        syms = [m["symbol"] for m in all_matches]
        fin_map = get_financials_for_symbols(syms, result_type="quarterly")
        cagr_map = get_cagr_for_symbols(syms, years=3)
        for m in all_matches:
            fin = fin_map.get(m["symbol"], {})
            cagr = cagr_map.get(m["symbol"], {})
            if fin:
                m["financials"] = fin
            if cagr and (cagr.get("revenue_cagr_pct") is not None or cagr.get("profit_cagr_pct") is not None):
                m["cagr"] = cagr

    if sort_by:
        reverse = sort_dir == "desc"
        sort_keys = {
            "market_cap": lambda m: m.get("market_cap", 0),
            "close": lambda m: m.get("close", 0),
            "volume": lambda m: m.get("volume", 0),
            "change_pct": lambda m: m.get("change_pct", 0),
            "revenue": lambda m: (m.get("financials") or {}).get("revenue") or 0,
            "operating_profit": lambda m: (m.get("financials") or {}).get("operating_profit") or 0,
            "opm_pct": lambda m: (m.get("financials") or {}).get("opm_pct") or 0,
            "net_profit": lambda m: (m.get("financials") or {}).get("net_profit") or 0,
            "npm_pct": lambda m: (m.get("financials") or {}).get("npm_pct") or 0,
            "pe_ratio": lambda m: (m.get("financials") or {}).get("pe_ratio") or 0,
            "pb_ratio": lambda m: (m.get("financials") or {}).get("pb_ratio") or 0,
            "peg": lambda m: (m.get("financials") or {}).get("peg") or 999,
            "roce_pct": lambda m: (m.get("financials") or {}).get("roce_pct") or 0,
            "roe_pct": lambda m: (m.get("financials") or {}).get("roe_pct") or 0,
            "revenue_growth_pct": lambda m: (m.get("financials") or {}).get("revenue_growth_pct") or 0,
            "profit_growth_pct": lambda m: (m.get("financials") or {}).get("profit_growth_pct") or 0,
            "revenue_cagr_pct": lambda m: (m.get("cagr") or {}).get("revenue_cagr_pct") or 0,
            "profit_cagr_pct": lambda m: (m.get("cagr") or {}).get("profit_cagr_pct") or 0,
        }
        if sort_by in sort_keys:
            all_matches.sort(key=sort_keys[sort_by], reverse=reverse)

    start = (page - 1) * page_size
    end = start + page_size
    page_matches = all_matches[start:end]

    return {
        "matches": page_matches,
        "total": total,
        "page": page,
        "page_size": page_size,
        "sectors": all_sectors,
        "total_scanned": total_scanned,
        "total_matched": total_matched,
        "include_financials": include_financials,
    }


class AIRecommendRequest(BaseModel):
    sector_filter: Optional[str] = None
    cap_filter: Optional[str] = None
    matched_only: bool = True
    max_stocks: int = 50


@app.post("/run/{strategy_id}/ai-recommend")
def ai_recommend(
    strategy_id: int,
    body: Optional[AIRecommendRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Get AI recommendations for screener results given current global/market context."""
    import os as _os
    body = body or AIRecommendRequest()
    api_key = _os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY not set. Add it to .env to use AI recommendations.",
        )

    strategy = crud.get_strategy(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if strategy.market_type != "stocks":
        raise HTTPException(status_code=400, detail="AI recommendations only for stock strategies")

    result = run_strategy_for_api(
        strategy_id, None, 1, 9999,
        market_type="stocks", timeframe=strategy.timeframe,
        matched_only=body.matched_only,
    )
    all_matches = [m for m in result["matches"] if m.get("matched")]
    if body.sector_filter and body.sector_filter != "all":
        if body.sector_filter in PARENT_SECTORS:
            all_matches = [m for m in all_matches if get_parent_sector(m.get("sector", "")) == body.sector_filter]
        else:
            all_matches = [m for m in all_matches if m.get("sector") == body.sector_filter]
    if body.cap_filter and body.cap_filter != "all":
        all_matches = [m for m in all_matches if m.get("market_cap_category", "").lower().replace(" ", "_") == body.cap_filter]
    max_n = body.max_stocks or 50
    subset = all_matches[:max_n]

    if not subset:
        return {"recommendation": "No matched stocks to analyze.", "error": None}

    syms = [m["symbol"] for m in subset]
    fin_map = get_financials_for_symbols(syms, result_type="quarterly")
    cagr_map = get_cagr_for_symbols(syms, years=3)
    for m in subset:
        m["financials"] = fin_map.get(m["symbol"], {})
        m["cagr"] = cagr_map.get(m["symbol"], {})

    def _row(m):
        sym = (m.get("symbol") or "").replace("NSE:", "").replace("-EQ", "")
        f = m.get("financials") or {}
        c = m.get("cagr") or {}
        parts = [sym, m.get("sector", "-"), m.get("market_cap_category", "-"), str(m.get("close", "-"))]
        if f.get("revenue"): parts.append(f"Rev:{f['revenue']:.0f}Cr")
        if f.get("pe_ratio"): parts.append(f"P/E:{f['pe_ratio']:.1f}")
        if f.get("roce_pct"): parts.append(f"ROCE:{f['roce_pct']}%")
        if c.get("revenue_cagr_pct"): parts.append(f"RevCAGR:{c['revenue_cagr_pct']}%")
        return " | ".join(parts)

    data_text = "\n".join(_row(m) for m in subset)
    prompt = f"""You are an equity research analyst. Below are {len(subset)} Indian (NSE) stocks that passed a technical screener. Consider current global macro context (rates, geopolitics, sector trends) and recommend the top 5-8 best picks for the current environment.

For each pick: symbol, 1-2 line rationale, key risk.

Stocks (symbol | sector | cap | close | revenue Cr | P/E | ROCE | RevCAGR):
{data_text}

Respond in clear markdown. No preamble."""

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=_os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
        )
        rec = resp.choices[0].message.content.strip()
        return {"recommendation": rec, "error": None, "stocks_analyzed": len(subset)}
    except Exception as e:
        return {"recommendation": None, "error": str(e), "stocks_analyzed": len(subset)}


# --- Sector Explorer ---

@app.get("/sectors")
def get_sectors(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sector: Optional[str] = None,
    cap_filter: Optional[str] = None,
    mcap_min: Optional[float] = None,
    mcap_max: Optional[float] = None,
    sort_by: str = "market_cap",
    sort_dir: str = "desc",
    group_sectors: bool = False,
    parent_sector: Optional[str] = None,
):
    return get_sector_overview(
        page=page, page_size=page_size,
        sector=sector, cap_filter=cap_filter,
        mcap_min=mcap_min, mcap_max=mcap_max,
        sort_by=sort_by, sort_dir=sort_dir,
        group_sectors=group_sectors,
        parent_sector=parent_sector,
    )

# --- Candlestick Patterns ---

@app.get("/patterns/structural")
def get_structural_patterns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    signal: Optional[str] = None,
    pattern: Optional[str] = None,
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = "strength",
    sort_dir: str = "desc",
    lookback: int = Query(25, ge=15, le=50),
    timeframe: str = Query("1D", pattern="^(1D|1W)$"),
    chart_bars: int = Query(120, ge=60, le=200),
):
    return scan_structural_patterns(
        page=page, page_size=page_size,
        signal_filter=signal, pattern_filter=pattern,
        cap_filter=cap_filter, sector_filter=sector_filter,
        sort_by=sort_by, sort_dir=sort_dir,
        lookback=lookback, timeframe=timeframe, chart_bars=chart_bars,
    )


@app.get("/patterns/52w")
def get_52w_patterns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    near_pct: Optional[float] = Query(None, description="Filter to within X% of 52w high (e.g. 5)"),
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = Query("pct_from_high", pattern="^(pct_from_high|pct_from_low|close|market_cap)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    chart_bars: int = Query(120, ge=60, le=200),
    chart_timeframe: str = Query("1D", pattern="^(1D|1W)$"),
):
    return scan_52w_high_low(
        page=page, page_size=page_size,
        near_pct=near_pct, cap_filter=cap_filter, sector_filter=sector_filter,
        sort_by=sort_by, sort_dir=sort_dir,
        chart_bars=chart_bars, chart_timeframe=chart_timeframe,
    )

@app.get("/patterns")
def get_patterns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    signal: Optional[str] = None,
    pattern: Optional[str] = None,
    cap_filter: Optional[str] = None,
    sector_filter: Optional[str] = None,
    sort_by: str = "strength",
    sort_dir: str = "desc",
    lookback: int = Query(3, ge=1, le=15),
):
    return scan_all_patterns(
        page=page, page_size=page_size,
        signal_filter=signal, pattern_filter=pattern,
        cap_filter=cap_filter, sector_filter=sector_filter,
        sort_by=sort_by, sort_dir=sort_dir,
        lookback=lookback,
    )

# --- Financials (separate from screener) ---

@app.get("/financials")
def financials_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = "revenue",
    sort_dir: str = "desc",
    result_type: str = "quarterly",
    sector: Optional[str] = None,
    search: Optional[str] = None,
):
    return get_financials_list(
        page=page, page_size=page_size,
        sort_by=sort_by, sort_dir=sort_dir,
        result_type=result_type,
        sector=sector, search=search,
    )

@app.get("/financials/summary")
def financials_summary():
    return get_financials_summary()

@app.get("/financials/latest-results")
def latest_results(
    days: int = Query(7, ge=1, le=90),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    source: Optional[str] = Query("all", pattern="^(all|nse|screener\.in)$"),
):
    return get_latest_results(days=days, page=page, page_size=page_size, source=source)

@app.get("/financials/{nse_symbol}")
def financials_detail(
    nse_symbol: str,
    result_type: str = "quarterly",
):
    return get_symbol_financials(nse_symbol, result_type)


# --- Slack (screener results) ---

@app.post("/run/{strategy_id}/slack")
def run_slack(
    strategy_id: int,
    sector_filter: Optional[str] = None,
    cap_filter: Optional[str] = None,
    matched_only: bool = True,
    max_lines: int = Query(15, ge=5, le=30),
    db: Session = Depends(get_db),
):
    """Post screener run results to Slack. Set SLACK_WEBHOOK_URL in .env."""
    import os as _os
    import requests as _rq
    webhook = _os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        raise HTTPException(status_code=400, detail="SLACK_WEBHOOK_URL not set in .env")

    strategy = crud.get_strategy(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    result = run_strategy_for_api(
        strategy_id, None, 1, 9999,
        market_type=strategy.market_type, timeframe=strategy.timeframe,
        matched_only=matched_only,
    )
    all_m = [m for m in result["matches"] if m.get("matched")]
    if sector_filter and sector_filter != "all":
        if sector_filter in PARENT_SECTORS:
            all_m = [m for m in all_m if get_parent_sector(m.get("sector", "")) == sector_filter]
        else:
            all_m = [m for m in all_m if m.get("sector") == sector_filter]
    if cap_filter and cap_filter != "all":
        all_m = [m for m in all_m if m.get("market_cap_category", "").lower().replace(" ", "_") == cap_filter]

    top = all_m[:max_lines]
    total = len(all_m)
    sc = result.get("total_scanned", 0)
    mt = result.get("total_matched", 0)
    lines = [f"• {m.get('symbol', '').replace('NSE:', '').replace('-EQ', '')} | {m.get('close', '-')} | {m.get('sector', '-')}" for m in top]
    body = (
        f"*Screener: {strategy.name}*\n"
        f"Scanned: {sc} | Matched: {mt}\n"
        f"Top {len(top)} (of {total}):\n" + "\n".join(lines)
    )
    try:
        r = _rq.post(webhook, json={"text": body}, timeout=10)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Slack returned {r.status_code}")
        return {"ok": True, "posted": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# --- Data Management / Admin ---

@app.get("/admin/data-status")
def admin_data_status():
    try:
        return get_data_status()
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/sync-symbols")
def admin_sync_symbols(mode: str = Query("full", pattern="^(full|check)$")):
    try:
        return sync_symbols(mode=mode)
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/update-ohlcv")
def admin_update_ohlcv(mode: str = Query("incremental", pattern="^(full|incremental)$")):
    try:
        return start_ohlcv_update(mode=mode)
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/update-financials")
def admin_update_financials(
    mode: str = Query("incremental", pattern="^(full|incremental|announcements_only)$"),
    limit: int = Query(0, ge=0, le=5000),
):
    try:
        return start_financials_update(mode=mode, limit=limit)
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/scrape-latest-results")
def admin_scrape_latest_results(days: int = Query(7, ge=1, le=90)):
    try:
        return start_latest_results_scrape(days=days)
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/scrape-screener-latest")
def admin_scrape_screener_latest():
    try:
        return start_screener_latest_scrape()
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/enrich-sectors")
def admin_enrich_sectors():
    try:
        return start_sector_enrichment()
    except Exception as e:
        return {"error": str(e)}


@app.post("/admin/daily-ai-report")
def admin_daily_ai_report():
    """Run all strategies, top 10 per sector, AI analysis (best sector/stocks), post to Slack."""
    try:
        return start_daily_ai_report()
    except Exception as e:
        return {"error": str(e)}


@app.get("/admin/job/{job_id}")
def admin_job_status(job_id: str):
    return get_job_status(job_id)


@app.get("/admin/jobs")
def admin_all_jobs():
    return get_all_jobs()


@app.post("/admin/fyers-token/generate")
def admin_generate_fyers_token():
    try:
        return generate_fyers_token()
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@app.get("/admin/fyers-token/validate")
def admin_validate_fyers_token():
    try:
        return validate_current_token()
    except Exception as e:
        return {"valid": False, "error": str(e)}

