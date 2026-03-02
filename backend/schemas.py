from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel

# --- Condition Schemas ---

class StrategyConditionBase(BaseModel):
    indicator_type: str
    params: Dict[str, Any]
    lookback_days: int
    operator: str
    threshold: Dict[str, Any]

class StrategyConditionCreate(StrategyConditionBase):
    pass

class StrategyConditionUpdate(BaseModel):
    indicator_type: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    lookback_days: Optional[int] = None
    operator: Optional[str] = None
    threshold: Optional[Dict[str, Any]] = None

class StrategyCondition(StrategyConditionBase):
    id: int
    strategy_id: int
    created_at: datetime

    class Config:
        orm_mode = True

# --- Strategy Schemas ---

class StrategyBase(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True
    market_type: str = "stocks"
    timeframe: str = "1D"

class StrategyCreate(StrategyBase):
    pass

class StrategyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    market_type: Optional[str] = None
    timeframe: Optional[str] = None

class Strategy(StrategyBase):
    id: int
    created_at: datetime
    updated_at: datetime
    conditions: List[StrategyCondition] = []

    class Config:
        orm_mode = True

class StrategyCreateWithConditions(StrategyBase):
    conditions: List[StrategyConditionCreate] = []
