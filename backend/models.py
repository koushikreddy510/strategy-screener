from sqlalchemy import Column, Integer, String, Boolean, Text, TIMESTAMP, JSON, ForeignKey, func
from sqlalchemy.orm import relationship
from .database import Base

class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    market_type = Column(String, nullable=False, default="stocks")
    timeframe = Column(String, nullable=False, default="1D")
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)

    conditions = relationship("StrategyCondition", back_populates="strategy", cascade="all, delete-orphan")

class StrategyCondition(Base):
    __tablename__ = "strategy_conditions"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator_type = Column(String, nullable=False)
    params = Column(JSON, nullable=False)
    lookback_days = Column(Integer, nullable=False)
    operator = Column(String, nullable=False)
    threshold = Column(JSON, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    strategy = relationship("Strategy", back_populates="conditions")