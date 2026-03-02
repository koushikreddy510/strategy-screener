from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from backend import crud, models, schemas
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from backend.database import SessionLocal, engine
from screener_engine import (
    run_strategy_for_api, load_ohlc,
    list_symbols, INDICATOR_METADATA, get_chart_data_with_indicators,
    invalidate_cache, get_sector_overview, scan_all_patterns,
)
from financials_engine import (
    get_financials_list, get_symbol_financials, get_financials_summary,
    get_latest_results,
)
from data_manager import (
    get_data_status, sync_symbols, start_ohlcv_update,
    start_financials_update, start_sector_enrichment,
    start_latest_results_scrape,
    get_job_status, get_all_jobs,
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
            "stocks": [{"label": "1 Day", "value": "1D"}],
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
        all_matches = [m for m in all_matches if m.get("sector", "") == sector_filter]

    if sort_by:
        reverse = sort_dir == "desc"
        sort_keys = {
            "market_cap": lambda m: m.get("market_cap", 0),
            "close": lambda m: m.get("close", 0),
            "volume": lambda m: m.get("volume", 0),
            "change_pct": lambda m: m.get("change_pct", 0),
        }
        if sort_by in sort_keys:
            all_matches.sort(key=sort_keys[sort_by], reverse=reverse)

    total = len(all_matches)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "matches": all_matches[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "sectors": all_sectors,
        "total_scanned": total_scanned,
        "total_matched": total_matched,
    }

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
    lookback: int = Query(3, ge=1, le=10),
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
):
    return get_latest_results(days=days, page=page, page_size=page_size)

@app.get("/financials/{nse_symbol}")
def financials_detail(
    nse_symbol: str,
    result_type: str = "quarterly",
):
    return get_symbol_financials(nse_symbol, result_type)


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
    mode: str = Query("incremental", pattern="^(full|incremental)$"),
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


@app.post("/admin/enrich-sectors")
def admin_enrich_sectors():
    try:
        return start_sector_enrichment()
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

