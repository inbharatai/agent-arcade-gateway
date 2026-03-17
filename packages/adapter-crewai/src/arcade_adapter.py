"""
agent-arcade-crewai -- CrewAI adapter for Agent Arcade

Auto-instruments CrewAI crews, agents, and tasks to emit Agent Arcade
telemetry for real-time visualization in the Arcade dashboard.

Usage:
    from crewai import Agent, Task, Crew
    from agent_arcade_crewai import wrap_crew

    crew = Crew(agents=[...], tasks=[...])
    wrap_crew(crew, gateway_url="http://localhost:47890", session_id="my-session")
    result = crew.kickoff()
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1

# ---------------------------------------------------------------------------
# Options dataclass
# ---------------------------------------------------------------------------


@dataclass
class ArcadeCrewAIOptions:
    """Configuration options for the CrewAI adapter.

    Attributes:
        gateway_url: URL of the Agent Arcade gateway (e.g. ``http://localhost:47890``).
        session_id: Unique session identifier for this run.
        api_key: Optional Bearer token sent in the ``Authorization`` header.
        agent_name_prefix: Short prefix prepended to agent names (default ``"Crew"``).
        auto_spawn: Automatically emit ``agent.spawn`` on first contact with an
            agent (default ``True``).
        track_tokens: Emit token-usage messages when LLM usage data is available
            (default ``True``).
        non_blocking: Fire-and-forget HTTP using background threads (default
            ``True``).  Set to ``False`` in tests to make sends synchronous.
    """

    gateway_url: str = "http://localhost:47890"
    session_id: str = "crewai-session"
    api_key: Optional[str] = None
    agent_name_prefix: str = "Crew"
    auto_spawn: bool = True
    track_tokens: bool = True
    non_blocking: bool = True


# ---------------------------------------------------------------------------
# Internal HTTP emitter
# ---------------------------------------------------------------------------


def _ts() -> int:
    return int(time.time() * 1000)


def _uid() -> str:
    return f"crew_{uuid.uuid4().hex[:12]}"


class _ArcadeEmitter:
    """Thread-safe, fire-and-forget HTTP emitter for the Agent Arcade protocol."""

    def __init__(self, options: ArcadeCrewAIOptions) -> None:
        self._url = options.gateway_url.rstrip("/")
        self._session_id = options.session_id
        self._api_key = options.api_key
        self._non_blocking = options.non_blocking
        self._lock = threading.Lock()

    # -- Internal ---------------------------------------------------------

    def _post(self, event: Dict[str, Any]) -> None:
        """Perform the HTTP POST, silently dropping errors."""
        try:
            body = json.dumps(event).encode()
            headers: Dict[str, str] = {"Content-Type": "application/json"}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            req = Request(
                f"{self._url}/v1/ingest",
                data=body,
                headers=headers,
                method="POST",
            )
            urlopen(req, timeout=5)
        except (URLError, OSError) as exc:
            logger.debug("Arcade emit failed (non-fatal): %s", exc)
        except Exception as exc:  # pragma: no cover
            logger.debug("Arcade emit unexpected error (non-fatal): %s", exc)

    def emit(self, event_type: str, agent_id: str, payload: Dict[str, Any]) -> None:
        """Build and dispatch an Agent Arcade protocol event."""
        event: Dict[str, Any] = {
            "v": PROTOCOL_VERSION,
            "ts": _ts(),
            "sessionId": self._session_id,
            "agentId": agent_id,
            "type": event_type,
            "payload": payload,
        }
        if self._non_blocking:
            t = threading.Thread(target=self._post, args=(event,), daemon=True)
            t.start()
        else:
            self._post(event)

    # -- Convenience helpers ----------------------------------------------

    def spawn(self, agent_id: str, name: str, role: str = "assistant") -> None:
        self.emit("agent.spawn", agent_id, {"name": name, "role": role})

    def state(
        self,
        agent_id: str,
        state: str,
        label: str = "",
        progress: float = -1.0,
    ) -> None:
        p: Dict[str, Any] = {"state": state}
        if label:
            p["label"] = label
        if 0.0 <= progress <= 1.0:
            p["progress"] = progress
        self.emit("agent.state", agent_id, p)

    def tool(self, agent_id: str, tool_name: str, label: str = "") -> None:
        p: Dict[str, Any] = {"name": tool_name}
        if label:
            p["label"] = label
        self.emit("agent.tool", agent_id, p)

    def message(self, agent_id: str, text: str) -> None:
        self.emit("agent.message", agent_id, {"text": text[:500]})

    def link(self, parent_id: str, child_id: str) -> None:
        self.emit(
            "agent.link",
            child_id,
            {"parentAgentId": parent_id, "childAgentId": child_id},
        )

    def end(self, agent_id: str, reason: str = "Completed", success: bool = True) -> None:
        self.emit("agent.end", agent_id, {"reason": reason, "success": success})

    def session_start(self, name: str = "") -> None:
        self.emit("session.start", "session", {"name": name})

    def session_end(self, reason: str = "Complete") -> None:
        self.emit("session.end", "session", {"reason": reason})


# ---------------------------------------------------------------------------
# Core callback class
# ---------------------------------------------------------------------------


class ArcadeCrewAICallback:
    """CrewAI callback handler that emits Agent Arcade telemetry events.

    Hooks into CrewAI's callback system via:

    * ``on_agent_action`` / ``on_agent_finish`` — agent decision lifecycle
    * ``on_tool_start`` / ``on_tool_end`` / ``on_tool_error`` — tool execution
    * ``on_chain_start`` / ``on_chain_end`` / ``on_chain_error`` — chain lifecycle
    * ``on_llm_start`` / ``on_llm_end`` / ``on_llm_error`` — LLM lifecycle
    * ``step_callback`` / ``task_callback`` — injected by :func:`wrap_crew`

    Designed to be used via :func:`wrap_crew` for the simplest integration, or
    constructed manually and attached to CrewAI's ``step_callback`` /
    ``task_callback`` attributes.

    Example::

        from crewai import Crew
        from agent_arcade_crewai import ArcadeCrewAICallback, ArcadeCrewAIOptions

        options = ArcadeCrewAIOptions(
            gateway_url="http://localhost:47890",
            session_id="my-session",
        )
        cb = ArcadeCrewAICallback(options)
        # Attach manually:
        crew.step_callback = cb.on_step
        crew.task_callback = cb.on_task_output
        result = crew.kickoff()
        cb.disconnect()
    """

    name = "ArcadeCrewAICallback"

    def __init__(self, options: ArcadeCrewAIOptions) -> None:
        self._emitter = _ArcadeEmitter(options)
        self._prefix = options.agent_name_prefix
        self._auto_spawn = options.auto_spawn
        self._track_tokens = options.track_tokens
        # Maps a stable agent identity key -> Arcade agent_id
        self._agent_ids: Dict[str, str] = {}
        # Maps a run_id string -> Arcade agent_id (for LangChain-style callbacks)
        self._run_ids: Dict[str, str] = {}
        # Task progress tracking
        self._task_count: int = 0
        self._completed_tasks: int = 0
        self._lock = threading.Lock()

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def disconnect(self) -> None:
        """End all active agents and signal session completion.

        Call this after ``crew.kickoff()`` returns or raises, to ensure
        clean session state in the Arcade dashboard.
        """
        with self._lock:
            for aid in list(self._agent_ids.values()):
                self._emitter.end(aid, reason="Session ended", success=True)
            self._agent_ids.clear()
            self._run_ids.clear()
        self._emitter.session_end("Session ended")

    # ── Agent identity helpers ─────────────────────────────────────────────

    def _agent_key(self, agent: Any) -> str:
        """Return a stable identity key for a CrewAI agent object."""
        return getattr(agent, "role", None) or str(id(agent))

    def _get_or_spawn(self, agent: Any) -> str:
        """Return (and optionally create) the Arcade agent_id for *agent*."""
        key = self._agent_key(agent)
        with self._lock:
            if key not in self._agent_ids:
                aid = _uid()
                self._agent_ids[key] = aid
                if self._auto_spawn:
                    role = getattr(agent, "role", "Agent")
                    goal = getattr(agent, "goal", "assistant")
                    name = f"{self._prefix}:{role}" if self._prefix else role
                    self._emitter.spawn(aid, name, str(goal)[:120])
            return self._agent_ids[key]

    def _get_or_spawn_by_run(self, run_id: str, name: str, role: str) -> str:
        """Return (and optionally create) the Arcade agent_id keyed by *run_id*."""
        with self._lock:
            if run_id not in self._run_ids:
                aid = _uid()
                self._run_ids[run_id] = aid
                if self._auto_spawn:
                    label = f"{self._prefix}:{name}" if self._prefix else name
                    self._emitter.spawn(aid, label, role)
            return self._run_ids[run_id]

    def _end_run(self, run_id: str, success: bool, reason: str = "Completed") -> None:
        with self._lock:
            aid = self._run_ids.pop(run_id, None)
        if aid:
            self._emitter.end(aid, reason=reason, success=success)

    # ── CrewAI step_callback / task_callback ────────────────────────────────

    def on_step(self, step_output: Any) -> None:
        """Handle a CrewAI step output (attach to ``crew.step_callback``).

        Emits ``agent.state(thinking)`` for reasoning steps and
        ``agent.tool`` + ``agent.state(tool)`` for tool invocations.

        Args:
            step_output: The ``AgentStep`` or compatible object emitted by
                CrewAI during a kickoff step.
        """
        agent = getattr(step_output, "agent", None)
        if agent is None:
            return
        aid = self._get_or_spawn(agent)

        thought = getattr(step_output, "thought", "") or ""
        tool_name = getattr(step_output, "tool", "") or ""
        tool_input = getattr(step_output, "tool_input", "") or ""

        if tool_name:
            self._emitter.tool(aid, str(tool_name), str(tool_input)[:200])
            self._emitter.state(aid, "tool", f"Using {tool_name}")
        elif thought:
            self._emitter.state(aid, "thinking", str(thought)[:200])

    def on_task_output(self, task_output: Any) -> None:
        """Handle a CrewAI task completion (attach to ``crew.task_callback``).

        Emits a ``agent.state(done)`` with progress tracking once a task
        finishes.

        Args:
            task_output: The ``TaskOutput`` or compatible object emitted by
                CrewAI when a task completes.
        """
        task = getattr(task_output, "task", None)
        agent = getattr(task_output, "agent", None) or (
            getattr(task, "agent", None) if task else None
        )
        if agent is None:
            return
        aid = self._get_or_spawn(agent)

        with self._lock:
            self._completed_tasks += 1
            progress = self._completed_tasks / max(self._task_count, 1)
            label = f"Task complete ({self._completed_tasks}/{self._task_count})"

        self._emitter.state(aid, "done", label, progress)

        # Surface the raw output as a message if present
        raw = getattr(task_output, "raw_output", None) or getattr(task_output, "output", None)
        if raw:
            self._emitter.message(aid, str(raw)[:500])

    # ── LLM callbacks ────────────────────────────────────────────────────────

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: str = "",
        parent_run_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call begins.

        Args:
            serialized: Dict describing the LLM (may contain ``name`` or ``id``).
            prompts: List of prompt strings being sent to the LLM.
            run_id: Unique identifier for this LLM run.
            parent_run_id: Optional parent run identifier for linking.
        """
        name = serialized.get("name") or "/".join(serialized.get("id", [])) or "LLM"
        aid = self._get_or_spawn_by_run(run_id, name, "llm")
        if parent_run_id:
            parent_aid = self._run_ids.get(parent_run_id)
            if parent_aid:
                self._emitter.link(parent_aid, aid)
        self._emitter.state(aid, "thinking", f"Processing {len(prompts)} prompt(s)")

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call completes.

        Emits token-usage information when available and ``track_tokens`` is
        enabled.

        Args:
            response: The LLM response object.  Expected to carry an optional
                ``llm_output`` dict with a ``tokenUsage`` key.
            run_id: Unique identifier for this LLM run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if aid and self._track_tokens:
            llm_output = getattr(response, "llm_output", None) or {}
            usage = llm_output.get("tokenUsage") or llm_output.get("token_usage") or {}
            if usage:
                total = usage.get("totalTokens") or usage.get("total_tokens") or "N/A"
                prompt_t = usage.get("promptTokens") or usage.get("prompt_tokens") or "?"
                comp_t = usage.get("completionTokens") or usage.get("completion_tokens") or "?"
                self._emitter.message(
                    aid,
                    f"Tokens: {total} (prompt: {prompt_t}, completion: {comp_t})",
                )
        self._end_run(run_id, success=True, reason="LLM call complete")

    def on_llm_error(
        self,
        error: Exception,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call fails.

        Args:
            error: The exception that was raised.
            run_id: Unique identifier for this LLM run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if aid:
            self._emitter.state(aid, "error", str(error)[:200])
        self._end_run(run_id, success=False, reason=f"LLM error: {str(error)[:100]}")

    # ── Chain callbacks ──────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: str = "",
        parent_run_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a LangChain chain begins execution.

        Args:
            serialized: Dict describing the chain.
            inputs: Input values passed to the chain.
            run_id: Unique identifier for this chain run.
            parent_run_id: Optional parent run identifier.
        """
        name = serialized.get("name") or "/".join(serialized.get("id", [])) or "Chain"
        aid = self._get_or_spawn_by_run(run_id, name, "chain")
        if parent_run_id:
            parent_aid = self._run_ids.get(parent_run_id)
            if parent_aid:
                self._emitter.link(parent_aid, aid)
        input_keys = ", ".join(inputs.keys()) if isinstance(inputs, dict) else ""
        self._emitter.state(aid, "thinking", f"Processing [{input_keys}]")

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a chain finishes successfully.

        Args:
            outputs: Output values produced by the chain.
            run_id: Unique identifier for this chain run.
        """
        self._end_run(run_id, success=True)

    def on_chain_error(
        self,
        error: Exception,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a chain raises an exception.

        Args:
            error: The exception that was raised.
            run_id: Unique identifier for this chain run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if aid:
            self._emitter.state(aid, "error", str(error)[:200])
        self._end_run(run_id, success=False, reason=f"Chain error: {str(error)[:100]}")

    # ── Tool callbacks ────────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: str = "",
        parent_run_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool begins execution.

        Args:
            serialized: Dict describing the tool (may contain ``name``).
            input_str: String representation of the tool's input.
            run_id: Unique identifier for this tool run.
            parent_run_id: Optional parent run identifier.
        """
        name = serialized.get("name") or "/".join(serialized.get("id", [])) or "Tool"
        aid = self._get_or_spawn_by_run(run_id, name, "tool")
        if parent_run_id:
            parent_aid = self._run_ids.get(parent_run_id)
            if parent_aid:
                self._emitter.link(parent_aid, aid)
        self._emitter.tool(aid, name, str(input_str)[:200])
        self._emitter.state(aid, "tool", f"Running {name}")

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a tool finishes execution.

        Args:
            output: The string output produced by the tool.
            run_id: Unique identifier for this tool run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if aid:
            self._emitter.message(aid, str(output)[:500])
        self._end_run(run_id, success=True)

    def on_tool_error(
        self,
        error: Exception,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a tool raises an exception.

        Args:
            error: The exception that was raised.
            run_id: Unique identifier for this tool run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if aid:
            self._emitter.state(aid, "error", str(error)[:200])
        self._end_run(run_id, success=False, reason=f"Tool error: {str(error)[:100]}")

    # ── Agent action callbacks ────────────────────────────────────────────────

    def on_agent_action(
        self,
        action: Any,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a LangChain-style agent selects an action.

        Works with CrewAI agents that surface action objects with ``tool``
        and ``tool_input`` attributes (mirrors the LangChain interface).

        Args:
            action: An action object with ``tool``, ``tool_input``, and
                optionally ``log`` attributes.
            run_id: Unique identifier for this agent run.
        """
        with self._lock:
            aid = self._run_ids.get(run_id)
        if not aid:
            return
        tool_name = getattr(action, "tool", None) or str(action)
        tool_input = getattr(action, "tool_input", "")
        if isinstance(tool_input, dict):
            tool_input = json.dumps(tool_input)
        self._emitter.tool(aid, str(tool_name), str(tool_input)[:200])
        self._emitter.state(aid, "tool", f"Using {tool_name}")

    def on_agent_finish(
        self,
        finish: Any,
        *,
        run_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when a LangChain-style agent finishes its task.

        Args:
            finish: A finish object (may carry ``return_values`` and ``log``).
            run_id: Unique identifier for this agent run.
        """
        self._end_run(run_id, success=True, reason="Agent completed")


# ---------------------------------------------------------------------------
# Public convenience function
# ---------------------------------------------------------------------------


def wrap_crew(
    crew: Any,
    *,
    gateway_url: str = "http://localhost:47890",
    session_id: str = "crewai-session",
    api_key: Optional[str] = None,
    agent_name_prefix: str = "Crew",
    auto_spawn: bool = True,
    track_tokens: bool = True,
    non_blocking: bool = True,
    options: Optional[ArcadeCrewAIOptions] = None,
) -> ArcadeCrewAICallback:
    """Attach Agent Arcade telemetry to a CrewAI ``Crew`` instance.

    Monkey-patches ``crew.kickoff`` so that session lifecycle events are
    emitted automatically.  Also injects ``step_callback`` and
    ``task_callback`` to capture fine-grained agent activity.  The original
    crew object is mutated in-place and returned callbacks allow you to call
    :meth:`ArcadeCrewAICallback.disconnect` when finished.

    Args:
        crew: A CrewAI ``Crew`` instance.
        gateway_url: URL of the Agent Arcade gateway.
        session_id: Unique session identifier for this run.
        api_key: Optional Bearer token for the gateway.
        agent_name_prefix: Short prefix prepended to spawned agent names.
        auto_spawn: Automatically emit ``agent.spawn`` events.
        track_tokens: Emit token-usage log messages.
        non_blocking: Use background threads for HTTP sends.
        options: Pre-built :class:`ArcadeCrewAIOptions`; overrides all other
            keyword arguments when provided.

    Returns:
        The :class:`ArcadeCrewAICallback` instance attached to *crew*.  Call
        :meth:`~ArcadeCrewAICallback.disconnect` on it when the session ends.

    Example::

        from crewai import Crew
        from agent_arcade_crewai import wrap_crew

        crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task])
        cb = wrap_crew(crew, gateway_url="http://localhost:47890", session_id="demo")
        result = crew.kickoff()
        cb.disconnect()
    """
    if options is None:
        options = ArcadeCrewAIOptions(
            gateway_url=gateway_url,
            session_id=session_id,
            api_key=api_key,
            agent_name_prefix=agent_name_prefix,
            auto_spawn=auto_spawn,
            track_tokens=track_tokens,
            non_blocking=non_blocking,
        )

    callback = ArcadeCrewAICallback(options)
    emitter = callback._emitter

    # Capture task count before patching so progress fractions are correct
    original_kickoff = crew.kickoff

    def _patched_kickoff(*args: Any, **kwargs: Any) -> Any:
        task_list = getattr(crew, "tasks", []) or []
        with callback._lock:
            callback._task_count = len(task_list)
            callback._completed_tasks = 0

        crew_name = getattr(crew, "name", "CrewAI Crew") or "CrewAI Crew"
        emitter.session_start(crew_name)

        # Inject step_callback (preserving any existing one)
        _original_step = getattr(crew, "step_callback", None)

        def _step_hook(step_output: Any) -> None:
            callback.on_step(step_output)
            if _original_step is not None:
                _original_step(step_output)

        crew.step_callback = _step_hook

        # Inject task_callback (preserving any existing one)
        _original_task_cb = getattr(crew, "task_callback", None)

        def _task_hook(task_output: Any) -> None:
            callback.on_task_output(task_output)
            if _original_task_cb is not None:
                _original_task_cb(task_output)

        crew.task_callback = _task_hook

        try:
            result = original_kickoff(*args, **kwargs)
            # End all tracked agents on success
            with callback._lock:
                agent_ids_copy = dict(callback._agent_ids)
            for aid in agent_ids_copy.values():
                emitter.end(aid, reason="Crew completed", success=True)
            emitter.session_end("All tasks complete")
            return result
        except Exception as exc:
            logger.error("Crew execution failed: %s", exc)
            emitter.session_end(f"Error: {str(exc)[:100]}")
            raise

    crew.kickoff = _patched_kickoff
    return callback
