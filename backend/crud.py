from sqlalchemy.orm import Session
from backend import models, schemas

# Strategy CRUD
def get_strategies(db: Session, skip: int = 0, limit: int = 100, market_type: str = None):
    q = db.query(models.Strategy)
    if market_type:
        q = q.filter(models.Strategy.market_type == market_type)
    return q.offset(skip).limit(limit).all()

def get_strategy(db: Session, strategy_id: int):
    return db.query(models.Strategy).filter(models.Strategy.id == strategy_id).first()

def create_strategy(db: Session, strategy: schemas.StrategyCreateWithConditions):
    db_obj = models.Strategy(
        name=strategy.name,
        description=strategy.description,
        is_active=strategy.is_active,
        market_type=strategy.market_type,
        timeframe=strategy.timeframe,
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    if strategy.conditions:
        for cond_data in strategy.conditions:
            db_cond = models.StrategyCondition(strategy_id=db_obj.id, **cond_data.dict())
            db.add(db_cond)
        db.commit()
        db.refresh(db_obj)
    return db_obj

def update_strategy(db: Session, strategy_id: int, updates: schemas.StrategyUpdate):
    db_obj = get_strategy(db, strategy_id)
    if not db_obj:
        return None
    for field, value in updates.dict(exclude_unset=True).items():
        setattr(db_obj, field, value)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete_strategy(db: Session, strategy_id: int):
    db_obj = get_strategy(db, strategy_id)
    if not db_obj:
        return None
    db.delete(db_obj)
    db.commit()
    return db_obj

# StrategyCondition CRUD
def get_conditions_for_strategy(db: Session, strategy_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.StrategyCondition)\
             .filter(models.StrategyCondition.strategy_id == strategy_id)\
             .offset(skip).limit(limit).all()

def get_condition(db: Session, condition_id: int):
    return db.query(models.StrategyCondition).filter(models.StrategyCondition.id == condition_id).first()

def create_condition(db: Session, strategy_id: int, condition: schemas.StrategyConditionCreate):
    db_obj = models.StrategyCondition(strategy_id=strategy_id, **condition.dict())
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update_condition(db: Session, condition_id: int, updates: schemas.StrategyConditionUpdate):
    db_obj = get_condition(db, condition_id)
    if not db_obj:
        return None
    for field, value in updates.dict(exclude_unset=True).items():
        setattr(db_obj, field, value)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete_condition(db: Session, condition_id: int):
    db_obj = get_condition(db, condition_id)
    if not db_obj:
        return None
    db.delete(db_obj)
    db.commit()
    return db_obj