"""
agent-arcade-crewai -- CrewAI adapter for Agent Arcade

Auto-instruments CrewAI crews, agents, and tasks to emit Agent Arcade
telemetry for real-time visualization in the pixel-art dashboard.

Usage:
    from crewai import Agent, Task, Crew
    from agent_arcade_crewai import arcade_crew

    crew = Crew(agents=[...], tasks=[...])
    wrapped = arcade_crew(crew, gateway_url="http://localhost:8787", session_id="demo")
    result = wrapped.kickoff()
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lightweight HTTP emitter (avoids hard dep on agent_arcade SDK)
# ---------------------------------------------------------------------------

import json
from urllib.request import Request, urlopen
from urllib.error import URLError

PROTOCOL_VERSION = 1


def _ts() -> int:
    return int(time.time() * 1000)


def _uid() -> str:
    return f"crew_{uuid.uuid4().hex[:12]}"


class _ArcadeEmitter:
    """Minimal telemetry emitter -- HTTP POST to gateway."""

    def __init__(self, url: str, session_id: str, auth_token: Optional[str] = None) -> None:
        self.url = url.rstrip("/")
        self.session_id = session_id
        self.auth_token = auth_token

    def emit(self, event_type: str, agent_id: str, payload: Dict[str, Any]) -> None:
        event = {
            "v": PROTOCOL_VERSION,
            "ts": _ts(),
            "sessionId": self.session_id,
            "agentId": agent_id,
            "type": event_type,
            "payload": payload,
        }
        try:
            body = json.dumps(event).encode()
            headers = {"Content-Type": "application/json"}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            req = Request(f"{self.url}/v1/ingest", data=body, headers=headers, method="POST")
            urlopen(req, timeout=5)
        except (URLError, OSError) as e:
            logger.debug(f"Arcade emit failed (non-fatal): {e}")

    def spawn(self, agent_id: str, name: str, role: str = "assistant") -> None:
        self.emit("agent.spawn", agent_id, {"name": name, "role": role})

    def state(self, agent_id: str, state: str, label: str = "", progress: float = -1) -> None:
        p: Dict[str, Any] = {"state": state, "label": label}
        if 0 <= progress <= 1:
            p["progress"] = progress
        self.emit("agent.state", agent_id, p)

    def tool(self, agent_id: str, tool_name: str, label: str = "") -> None:
        self.emit("agent.tool", agent_id, {"name": tool_name, "label": label})

    def message(self, agent_id: str, text: str) -> None:
        self.emit("agent.message", agent_id, {"text": text})

    def link(self, parent_id: str, child_id: str) -> None:
        self.emit("agent.link", child_id, {"parentAgentId": parent_id, "childAgentId": child_id})

    def end(self, agent_id: str, reason: str = "Completed", success: bool = True) -> None:
        self.emit("agent.end", agent_id, {"reason": reason, "success": success})

    def session_start(self, name: str = "") -> None:
        self.emit("session.start", "session", {"name": name})

    def session_end(self, reason: str = "Complete") -> None:
        self.emit("session.end", "session", {"reason": reason})


# ---------------------------------------------------------------------------
# CrewAI Callback Hooks
# ---------------------------------------------------------------------------

class ArcadeCrewCallbacks:
    """
    Callback hooks for CrewAI that emit Agent Arcade telemetry.

    Tracks:
    - Crew kickoff/completion -> session lifecycle
    - Agent start/thinking/writing -> agent state changes
    - Tool usage -> agent.tool events
    - Task start/complete -> progress tracking
    - Delegation -> parent-child agent links
    """

    def __init__(self, emitter: _ArcadeEmitter) -> None:
        self._emitter = emitter
        self._agent_ids: Dict[str, str] = {}  # crew_agent_role -> arcade_agent_id
        self._task_count = 0
        self._completed_tasks = 0

    def _get_agent_id(self, agent: Any) -> str:
        """Get or create an Arcade agent ID for a CrewAI agent."""
        key = getattr(agent, "role", str(id(agent)))
        if key not in self._agent_ids:
            aid = _uid()
            name = getattr(agent, "role", "Agent")
            role = getattr(agent, "goal", "assistant")
            self._emitter.spawn(aid, name, role[:100])
            self._agent_ids[key] = aid
        return self._agent_ids[key]

    def on_crew_start(self, crew: Any) -> None:
        """Called when a crew kicks off."""
        name = getattr(crew, "name", "CrewAI Crew")
        self._task_count = len(getattr(crew, "tasks", []))
        self._emitter.session_start(name)

    def on_crew_end(self, crew: Any, result: Any) -> None:
        """Called when a crew finishes all tasks."""
        # End all agents
        for role, aid in self._agent_ids.items():
            self._emitter.end(aid, reason="Crew completed", success=True)
        self._emitter.session_end("All tasks complete")

    def on_agent_start(self, agent: Any) -> None:
        """Called when an agent begins work."""
        aid = self._get_agent_id(agent)
        self._emitter.state(aid, "thinking", "Analyzing task...")

    def on_agent_thinking(self, agent: Any, thought: str = "") -> None:
        """Called when an agent is reasoning."""
        aid = self._get_agent_id(agent)
        self._emitter.state(aid, "thinking", thought[:200] or "Reasoning...")

    def on_tool_use(self, agent: Any, tool_name: str, tool_input: str = "") -> None:
        """Called when an agent uses a tool."""
        aid = self._get_agent_id(agent)
        self._emitter.tool(aid, tool_name, tool_input[:200])
        self._emitter.state(aid, "tool", f"Using {tool_name}")

    def on_task_start(self, task: Any, agent: Any) -> None:
        """Called when a task begins."""
        aid = self._get_agent_id(agent)
        desc = getattr(task, "description", "")[:200]
        self._emitter.state(aid, "reading", f"Task: {desc}")

    def on_task_complete(self, task: Any, agent: Any, output: Any = None) -> None:
        """Called when a task is completed."""
        aid = self._get_agent_id(agent)
        self._completed_tasks += 1
        progress = self._completed_tasks / max(self._task_count, 1)
        self._emitter.state(aid, "done", f"Task complete ({self._completed_tasks}/{self._task_count})", progress)

    def on_delegation(self, from_agent: Any, to_agent: Any, task: Any) -> None:
        """Called when an agent delegates to another."""
        parent_id = self._get_agent_id(from_agent)
        child_id = self._get_agent_id(to_agent)
        self._emitter.link(parent_id, child_id)
        self._emitter.state(child_id, "thinking", "Delegated task received")

    def on_agent_output(self, agent: Any, output: str) -> None:
        """Called when an agent produces output."""
        aid = self._get_agent_id(agent)
        self._emitter.state(aid, "writing", output[:200])
        self._emitter.message(aid, output[:500])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def arcade_crew(
    crew: Any,
    gateway_url: str = "http://localhost:8787",
    session_id: str = "crewai-session",
    auth_token: Optional[str] = None,
) -> Any:
    """
    Wrap a CrewAI Crew instance with Agent Arcade telemetry.

    The wrapped crew emits real-time events to the Arcade gateway
    for visualization. The original crew object is returned with
    hooks injected -- all existing behavior is preserved.

    Args:
        crew: A CrewAI Crew instance
        gateway_url: Agent Arcade gateway URL
        session_id: Session identifier for this run
        auth_token: Optional authentication token

    Returns:
        The same crew instance with Arcade telemetry hooks

    Example:
        from crewai import Agent, Task, Crew
        from agent_arcade_crewai import arcade_crew

        researcher = Agent(role="Researcher", goal="Find information")
        writer = Agent(role="Writer", goal="Write content")
        task = Task(description="Research and write about AI", agent=researcher)

        crew = Crew(agents=[researcher, writer], tasks=[task])
        wrapped = arcade_crew(crew, session_id="research-crew")
        result = wrapped.kickoff()
    """
    emitter = _ArcadeEmitter(gateway_url, session_id, auth_token)
    callbacks = ArcadeCrewCallbacks(emitter)

    # Monkey-patch the kickoff method
    original_kickoff = crew.kickoff

    def patched_kickoff(*args: Any, **kwargs: Any) -> Any:
        callbacks.on_crew_start(crew)
        try:
            # Set up step callbacks if CrewAI supports them
            if hasattr(crew, "step_callback"):
                original_step = crew.step_callback

                def step_hook(step_output: Any) -> None:
                    agent = getattr(step_output, "agent", None)
                    if agent:
                        thought = getattr(step_output, "thought", "")
                        if thought:
                            callbacks.on_agent_thinking(agent, thought)
                        tool = getattr(step_output, "tool", "")
                        if tool:
                            tool_input = getattr(step_output, "tool_input", "")
                            callbacks.on_tool_use(agent, tool, str(tool_input))
                    if original_step:
                        original_step(step_output)

                crew.step_callback = step_hook

            # Set up task callbacks
            if hasattr(crew, "task_callback"):
                original_task_cb = crew.task_callback

                def task_hook(task_output: Any) -> None:
                    task = getattr(task_output, "task", None)
                    agent = getattr(task_output, "agent", None) or getattr(task, "agent", None)
                    if agent:
                        callbacks.on_task_complete(task, agent, task_output)
                    if original_task_cb:
                        original_task_cb(task_output)

                crew.task_callback = task_hook

            result = original_kickoff(*args, **kwargs)
            callbacks.on_crew_end(crew, result)
            return result
        except Exception as e:
            logger.error(f"Crew execution failed: {e}")
            emitter.session_end(f"Error: {str(e)[:100]}")
            raise

    crew.kickoff = patched_kickoff
    return crew


def arcade_agent(
    gateway_url: str = "http://localhost:8787",
    session_id: str = "crewai-session",
    auth_token: Optional[str] = None,
) -> Callable:
    """
    Decorator to wrap a CrewAI agent creation function with Arcade telemetry.

    @arcade_agent(gateway_url="http://localhost:8787", session_id="demo")
    def create_researcher():
        return Agent(role="Researcher", goal="Find info", backstory="...")
    """
    emitter = _ArcadeEmitter(gateway_url, session_id, auth_token)

    def decorator(func: Callable) -> Callable:
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            agent = func(*args, **kwargs)
            aid = _uid()
            name = getattr(agent, "role", "Agent")
            emitter.spawn(aid, name, getattr(agent, "goal", "assistant")[:100])
            return agent
        return wrapper
    return decorator
