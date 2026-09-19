from __future__ import annotations

import json
import time
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.app.main import get_event_bus

router = APIRouter()


@router.get("/pipeline_events")
async def pipeline_events():
    """Server-Sent Events stream of pipeline lifecycle events.

    Events are written as ``data: {json}\\n\\n`` blobs; clients can filter on
    ``event.run_id`` and ``event.stage``.
    """

    async def gen() -> AsyncGenerator[str, None]:
        try:
            last_index = 0
            while True:
                bus = get_event_bus()
                for event in bus[last_index:]:
                    yield f"data: {json.dumps(event)}\n\n"
                last_index = len(bus)
                await asyncio.sleep(1)
        except asyncio.CancelledError:  # client disconnected
            return

    import asyncio
    return StreamingResponse(gen(), media_type="text/event-stream")