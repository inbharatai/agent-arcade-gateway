"""
agent-arcade SDK for Python

Emits Agent Arcade telemetry via Socket.IO or HTTP POST fallback.

Usage:
    from agent_arcade import AgentArcade

    arcade = AgentArcade(url="http://localhost:8787", session_id="my-session")
    agent_id = arcade.spawn(name="Planner")
    arcade.state(agent_id, "thinking", label="Analyzing requirements…")
    arcade.tool(agent_id, "read_file", label="Reading spec.md")
    arcade.state(agent_id, "writing", label="Drafting code")
    arcade.end(agent_id, reason="Done", success=True)
    arcade.disconnect()
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, Literal, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError

PROTOCOL_VERSION = 1

AgentState = Literal[
    "idle", "thinking", "reading", "writing", "tool",
    "waiting", "moving", "error", "done",
]

EventType = Literal[
    "agent.spawn", "agent.state", "agent.tool", "agent.message",
    "agent.link", "agent.position", "agent.end",
    "session.start", "session.end",
]


def _ts() -> int:
    return int(time.time() * 1000)


def _uid() -> str:
    return f"agent_{uuid.uuid4().hex[:12]}"


class AgentArcade:
    """Lightweight telemetry emitter — works with or without python-socketio."""

    def __init__(
        self,
        url: str = "http://localhost:8787",
        session_id: str = "default",
        auth_token: Optional[str] = None,
        auto_connect: bool = True,
    ) -> None:
        self.url = url.rstrip("/")
        self.session_id = session_id
        self.auth_token = auth_token
        self._sio: Any = None

        if auto_connect:
            self.connect()

    # ── Connection ───────────────────────────────────────────────────────
    def connect(self) -> None:
        """Try Socket.IO first, fall back to HTTP-only mode with a warning."""
        try:
            import socketio  # type: ignore

            self._sio = socketio.Client(reconnection=True)
            self._sio.connect(self.url, transports=["websocket", "polling"])
            self._sio.emit("subscribe", {
                "sessionId": self.session_id,
                "token": self.auth_token,
            })
        except ImportError:
            import logging
            logging.getLogger(__name__).warning(
                "python-socketio not installed — using HTTP-only fallback. "
                "Install it with: pip install python-socketio[client]"
            )
            self._sio = None
        except Exception:
            self._sio = None  # HTTP fallback

    def disconnect(self) -> None:
        if self._sio:
            try:
                self._sio.disconnect()
            except Exception:
                pass
        self._sio = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.disconnect()

    # ── Internal emit ────────────────────────────────────────────────────
    def _emit(self, event: Dict[str, Any]) -> None:
        if self._sio:
            try:
                self._sio.emit("event", event)
                return
            except Exception:
                pass

        # HTTP fallback
        try:
            body = json.dumps(event).encode()
            req = Request(
                f"{self.url}/v1/ingest",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urlopen(req, timeout=5)
        except (URLError, OSError):
            pass

    def _event(
        self,
        event_type: str,
        agent_id: str,
        payload: Dict[str, Any],
    ) -> None:
        self._emit({
            "v": PROTOCOL_VERSION,
            "ts": _ts(),
            "sessionId": self.session_id,
            "agentId": agent_id,
            "type": event_type,
            "payload": payload,
        })

    # ── Public API ───────────────────────────────────────────────────────
    def spawn(
        self,
        name: str = "Agent",
        role: str = "assistant",
        agent_id: Optional[str] = None,
    ) -> str:
        aid = agent_id or _uid()
        self._event("agent.spawn", aid, {"name": name, "role": role})
        return aid

    def state(
        self,
        agent_id: str,
        state: AgentState,
        *,
        label: Optional[str] = None,
        progress: Optional[float] = None,
    ) -> None:
        p: Dict[str, Any] = {"state": state}
        if label is not None:
            p["label"] = label
        if progress is not None:
            p["progress"] = max(0.0, min(1.0, progress))
        self._event("agent.state", agent_id, p)

    def tool(
        self,
        agent_id: str,
        tool_name: str,
        *,
        path: Optional[str] = None,
        label: Optional[str] = None,
    ) -> None:
        p: Dict[str, Any] = {"name": tool_name}
        if path:
            p["path"] = path
        if label:
            p["label"] = label
        self._event("agent.tool", agent_id, p)

    def message(
        self,
        agent_id: str,
        text: str,
        *,
        level: Optional[str] = None,
        requires_input: bool = False,
    ) -> None:
        p: Dict[str, Any] = {"text": text}
        if level:
            p["level"] = level
        if requires_input:
            p["requiresInput"] = True
        self._event("agent.message", agent_id, p)

    def link(self, parent_agent_id: str, child_agent_id: str) -> None:
        self._event("agent.link", child_agent_id, {
            "parentAgentId": parent_agent_id,
            "childAgentId": child_agent_id,
        })

    def position(self, agent_id: str, x: int, y: int) -> None:
        self._event("agent.position", agent_id, {"x": x, "y": y})

    def end(
        self,
        agent_id: str,
        *,
        reason: str = "Completed",
        success: bool = True,
    ) -> None:
        self._event("agent.end", agent_id, {"reason": reason, "success": success})
