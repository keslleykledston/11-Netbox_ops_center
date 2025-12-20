import logging
from typing import Optional

import asyncpg

from backend.core.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def init_db() -> Optional[asyncpg.Pool]:
    global _pool
    if _pool is not None:
        return _pool
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL nao configurado; persistencia local desabilitada.")
        return None
    _pool = await asyncpg.create_pool(dsn=settings.DATABASE_URL, min_size=1, max_size=5)
    logger.info("Conexao com banco local inicializada.")
    return _pool


async def get_pool() -> Optional[asyncpg.Pool]:
    global _pool
    if _pool is None:
        await init_db()
    return _pool


async def close_db() -> None:
    global _pool
    if _pool is None:
        return
    await _pool.close()
    _pool = None
    logger.info("Conexao com banco local encerrada.")
