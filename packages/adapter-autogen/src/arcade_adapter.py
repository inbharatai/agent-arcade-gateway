"""
agent-arcade-autogen -- AutoGen adapter for Agent Arcade

Auto-instruments AutoGen (0.2.x ConversableAgent / 0.4.x AgentChat) to emit
Agent Arcade telemetry for real-time visualization in the Arcade dashboard.

Uses duck typing throughout — AutoGen is never imported directly, so this
package works as a zero-dependency drop-in even when AutoGen is not installed
in the same environment (you will obviously need it at runtime).

Usage::

    from autogen import AssistantAgent, UserProxyAgent
    from agent_arcade_autogen import wrap_agents

    assistant = AssistantAgent("coder", llm_config={"model": "gpt-4o"})
    executor  = UserProxyAgent("executor", code_execution_config={"work_dir": "coding"})

    wrap_agents(
        [assistant, executor],
        gateway_url="http://localhost:47890",
        session_id="autogen-demo",
    )

    executor.initiate_chat(assistant, message="Write a hello world script")
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1

# ---------------------------------------------------------------------------
# Options dataclass
# ---------------------------------------------------------------------------


@dataclass
class ArcadeAutoGenOptions:
    """Configuration options for the AutoGen adapter.

    Attributes:
        gateway_url: URL of the Agent Arcade gateway (e.g. ``http://localhost:47890``).
        session_id: Unique session identifier for this run.
        api_key: Optional Bearer token sent in the ``Authorization`` header.
        agent_name_prefix: Short prefix prepended to spawned agent names.
            Leave empty (``""``) to use the AutoGen agent name as-is.
        auto_spawn: Automatically emit ``agent.spawn`` on first contact with an
            agent (default ``True``).
        track_tool_calls: Emit ``agent.tool`` events for function/tool calls
            found in message dicts (default ``True``).
        non_blocking: Fire-and-forget HTTP using background threads (default
            ``True``).  Set to ``False`` in tests to make sends synchronous.
    """

    gateway_url: str = "http://localhost:47890"
    session_id: str = "autogen-session"
    api_key: Optional[str] = None
    agent_name_prefix: str = ""
    auto_spawn: bool = True
    track_tool_calls: bool = True
    non_blocking: bool = True


# ---------------------------------------------------------------------------
# Internal HTTP emitter
# ---------------------------------------------------------------------------


def _ts() -> int:
    return int(time.time() * 1000)


def _uid() -> str:
    return f"ag_{uuid.uuid4().hex[:12]}"


class _ArcadeEmitter:
    """Thread-safe, fire-and-forget HTTP emitter for the Agent Arcade protocol."""

    def __init__(self, options: ArcadeAutoGenOptions) -> None:
        from urllib.request import Request, urlopen  # stdlib — always available
        from urllib.error import URLError

        self._Request = Request
        self._urlopen = urlopen
        self._URLError = URLError

        self._url = options.gateway_url.rstrip("/")
        self._session_id = options.session_id
        self._api_key = options.api_key
        self._non_blocking = options.non_blocking
        self._lock = threading.Lock()

    def _post(self, event: Dict[str, Any]) -> None:
        try:
            body = json.dumps(event).encode()
            headers: Dict[str, str] = {"Content-Type": "application/json"}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            req = self._Request(
                f"{self._url}/v1/ingest",
                data=body,
                headers=headers,
                method="POST",
            )
            self._urlopen(req, timeout=5)
        except Exception as exc:
            logger.debug("Arcade emit failed (non-fatal): %s", exc)

    def emit(self, event_type: str, agent_id: str, payload: Dict[str, Any]) -> None:
        """Build and dispatch a single Agent Arcade protocol event."""
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

    # Convenience wrappers

    def spawn(self, agent_id: str, name: str, role: str = "assistant") -> None:
        self.emit("agent.spawn", agent_id, {"name": name, "role": role})

    def state(self, agent_id: str, state: str, label: str = "") -> None:
        p: Dict[str, Any] = {"state": state}
        if label:
            p["label"] = label
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
# Core adapter class
# ---------------------------------------------------------------------------


class ArcadeAutoGenAdapter:
    """AutoGen adapter that emits Agent Arcade telemetry events.

    Wraps AutoGen ``ConversableAgent`` instances (or any duck-typed equivalent)
    by monkey-patching their ``generate_reply``, ``send``, and ``receive``
    methods.  No AutoGen symbols are imported; the adapter works via
    attribute inspection on whatever objects you pass.

    Tracked events:

    * ``send`` — emits ``agent.message`` and inspects for function/tool calls
    * ``receive`` / ``generate_reply`` — emits ``agent.state(thinking)`` and
      ``agent.state(writing)``
    * Code execution (detected via ``code_execution_config``) — emits
      ``agent.tool(code_executor)``
    * Tool / function calls in message dicts — emits ``agent.tool``
    * Session lifecycle — ``session.start`` on first ``attach`` / ``attach_all``,
      ``session.end`` on ``disconnect``

    Example::

        from autogen import AssistantAgent, UserProxyAgent
        from agent_arcade_autogen import ArcadeAutoGenAdapter, ArcadeAutoGenOptions

        options = ArcadeAutoGenOptions(
            gateway_url="http://localhost:47890",
            session_id="my-session",
        )
        adapter = ArcadeAutoGenAdapter(options)
        adapter.attach_all([assistant, user_proxy])

        user_proxy.initiate_chat(assistant, message="Hello!")
        adapter.disconnect()
    """

    def __init__(self, options: ArcadeAutoGenOptions) -> None:
        self._emitter = _ArcadeEmitter(options)
        self._prefix = options.agent_name_prefix
        self._auto_spawn = options.auto_spawn
        self._track_tool_calls = options.track_tool_calls

        # Maps agent name -> Arcade agent_id
        self._agent_ids: Dict[str, str] = {}
        self._attached_agents: List[Any] = []
        self._turn_count: int = 0
        self._lock = threading.Lock()
        self._session_started: bool = False

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def disconnect(self) -> None:
        """End all active agents and close the session.

        Call this after the conversation finishes to ensure the Arcade
        dashboard shows the session as complete.
        """
        with self._lock:
            for aid in list(self._agent_ids.values()):
                self._emitter.end(
                    aid,
                    reason=f"Session ended ({self._turn_count} turns)",
                    success=True,
                )
            self._agent_ids.clear()
        self._emitter.session_end("Session ended")

    # ── Agent management ───────────────────────────────────────────────────

    def attach(self, agent: Any) -> str:
        """Wrap a single AutoGen agent with Arcade telemetry.

        Patches ``send``, ``receive``, and ``generate_reply`` if they exist.
        Safe to call multiple times on the same agent (subsequent calls are
        no-ops for already-patched methods).

        Args:
            agent: An AutoGen ``ConversableAgent`` or duck-typed equivalent.

        Returns:
            The Arcade ``agent_id`` assigned to this agent.
        """
        if not self._session_started:
            self._emitter.session_start(
                f"AutoGen Session ({len(self._attached_agents) + 1} agent(s))"
            )
            self._session_started = True

        aid = self._get_or_spawn(agent)

        # Avoid double-patching
        marker = "_arcade_patched"
        if getattr(agent, marker, False):
            return aid
        object.__setattr__(agent, marker, True) if hasattr(agent, "__dict__") else None
        try:
            agent._arcade_patched = True  # works for most class instances
        except AttributeError:
            pass

        self._patch_agent(agent)
        with self._lock:
            self._attached_agents.append(agent)
        return aid

    def attach_all(self, agents: List[Any]) -> List[str]:
        """Wrap multiple AutoGen agents with Arcade telemetry.

        Args:
            agents: A list of AutoGen agents.

        Returns:
            List of Arcade ``agent_id`` strings, one per agent.
        """
        return [self.attach(a) for a in agents]

    # ── Internal helpers ───────────────────────────────────────────────────

    def _agent_name(self, agent: Any) -> str:
        return getattr(agent, "name", None) or str(id(agent))

    def _get_or_spawn(self, agent: Any) -> str:
        name = self._agent_name(agent)
        with self._lock:
            if name not in self._agent_ids:
                aid = _uid()
                self._agent_ids[name] = aid
                if self._auto_spawn:
                    display = f"{self._prefix}:{name}" if self._prefix else name
                    role = self._infer_role(agent)
                    self._emitter.spawn(aid, display, role)
            return self._agent_ids[name]

    @staticmethod
    def _infer_role(agent: Any) -> str:
        """Heuristically determine the agent's role for the Arcade spawn event."""
        # UserProxyAgent / HumanProxyAgent usually have _is_termination_msg
        if getattr(agent, "code_execution_config", None):
            return "executor"
        if getattr(agent, "_is_termination_msg", None) is not None:
            return "user-proxy"
        if getattr(agent, "system_message", None):
            return "assistant"
        return "assistant"

    def _extract_tool_calls(self, message: Any, sender_id: str) -> None:
        """Inspect a message dict and emit tool events for any function/tool calls."""
        if not self._track_tool_calls:
            return
        if not isinstance(message, dict):
            return

        func_call = message.get("function_call")
        if func_call and isinstance(func_call, dict):
            fname = func_call.get("name", "function")
            args = str(func_call.get("arguments", ""))[:200]
            self._emitter.tool(sender_id, fname, args)
            self._emitter.state(sender_id, "tool", f"Calling {fname}")

        tool_calls = message.get("tool_calls")
        if tool_calls and isinstance(tool_calls, list):
            for tc in tool_calls:
                if isinstance(tc, dict):
                    func = tc.get("function") or {}
                    tname = func.get("name") or tc.get("name") or "tool"
                    targs = str(func.get("arguments", ""))[:200]
                    self._emitter.tool(sender_id, tname, targs)
                    self._emitter.state(sender_id, "tool", f"Calling {tname}")

    def _patch_agent(self, agent: Any) -> None:
        """Monkey-patch the agent's key methods to emit telemetry."""

        # ── send ──────────────────────────────────────────────────────────
        if hasattr(agent, "send"):
            orig_send = agent.send

            def _make_send(ag: Any, orig: Callable) -> Callable:
                def patched_send(
                    message: Any,
                    recipient: Any,
                    *args: Any,
                    **kwargs: Any,
                ) -> Any:
                    sender_id = self._get_or_spawn(ag)
                    receiver_id = self._get_or_spawn(recipient)

                    with self._lock:
                        self._turn_count += 1

                    # Link direction: sender -> receiver
                    self._emitter.link(sender_id, receiver_id)

                    # Emit tool calls embedded in the message
                    self._extract_tool_calls(message, sender_id)

                    # Emit message content
                    content: str = ""
                    if isinstance(message, dict):
                        content = str(message.get("content") or "")
                    elif isinstance(message, str):
                        content = message
                    else:
                        content = str(message)

                    if content.strip():
                        self._emitter.message(sender_id, content)

                    self._emitter.state(sender_id, "waiting", "Waiting for reply")
                    return orig(message, recipient, *args, **kwargs)

                return patched_send

            agent.send = _make_send(agent, orig_send)

        # ── a_send (async send) ───────────────────────────────────────────
        if hasattr(agent, "a_send"):
            orig_a_send = agent.a_send

            def _make_a_send(ag: Any, orig: Callable) -> Callable:
                async def patched_a_send(
                    message: Any,
                    recipient: Any,
                    *args: Any,
                    **kwargs: Any,
                ) -> Any:
                    sender_id = self._get_or_spawn(ag)
                    receiver_id = self._get_or_spawn(recipient)
                    with self._lock:
                        self._turn_count += 1
                    self._emitter.link(sender_id, receiver_id)
                    self._extract_tool_calls(message, sender_id)
                    content = (
                        str(message.get("content") or "")
                        if isinstance(message, dict)
                        else str(message)
                    )
                    if content.strip():
                        self._emitter.message(sender_id, content)
                    self._emitter.state(sender_id, "waiting", "Waiting for reply")
                    return await orig(message, recipient, *args, **kwargs)

                return patched_a_send

            agent.a_send = _make_a_send(agent, orig_a_send)

        # ── receive ────────────────────────────────────────────────────────
        if hasattr(agent, "receive"):
            orig_receive = agent.receive

            def _make_receive(ag: Any, orig: Callable) -> Callable:
                def patched_receive(
                    message: Any,
                    sender: Any,
                    *args: Any,
                    **kwargs: Any,
                ) -> Any:
                    aid = self._get_or_spawn(ag)
                    if getattr(ag, "code_execution_config", None):
                        self._emitter.state(aid, "tool", "Executing code...")
                        self._emitter.tool(aid, "code_executor", "Running generated code")
                    else:
                        self._emitter.state(aid, "thinking", f"{self._agent_name(ag)} reasoning...")
                    result = orig(message, sender, *args, **kwargs)
                    self._emitter.state(aid, "writing", "Reply generated")
                    return result

                return patched_receive

            agent.receive = _make_receive(agent, orig_receive)

        # ── a_receive (async receive) ─────────────────────────────────────
        if hasattr(agent, "a_receive"):
            orig_a_receive = agent.a_receive

            def _make_a_receive(ag: Any, orig: Callable) -> Callable:
                async def patched_a_receive(
                    message: Any,
                    sender: Any,
                    *args: Any,
                    **kwargs: Any,
                ) -> Any:
                    aid = self._get_or_spawn(ag)
                    if getattr(ag, "code_execution_config", None):
                        self._emitter.state(aid, "tool", "Executing code...")
                        self._emitter.tool(aid, "code_executor", "Running generated code")
                    else:
                        self._emitter.state(aid, "thinking", f"{self._agent_name(ag)} reasoning...")
                    result = await orig(message, sender, *args, **kwargs)
                    self._emitter.state(aid, "writing", "Reply generated")
                    return result

                return patched_a_receive

            agent.a_receive = _make_a_receive(agent, orig_a_receive)

        # ── generate_reply ────────────────────────────────────────────────
        if hasattr(agent, "generate_reply"):
            orig_gen = agent.generate_reply

            def _make_gen(ag: Any, orig: Callable) -> Callable:
                def patched_gen(*args: Any, **kwargs: Any) -> Any:
                    aid = self._get_or_spawn(ag)
                    if getattr(ag, "code_execution_config", None):
                        self._emitter.state(aid, "tool", "Preparing code execution...")
                    else:
                        self._emitter.state(aid, "thinking", f"{self._agent_name(ag)} generating reply...")
                    result = orig(*args, **kwargs)
                    # Inspect the reply for embedded tool calls
                    if isinstance(result, dict):
                        self._extract_tool_calls(result, aid)
                    self._emitter.state(aid, "writing", "Reply ready")
                    return result

                return patched_gen

            agent.generate_reply = _make_gen(agent, orig_gen)

        # ── a_generate_reply (async) ──────────────────────────────────────
        if hasattr(agent, "a_generate_reply"):
            orig_a_gen = agent.a_generate_reply

            def _make_a_gen(ag: Any, orig: Callable) -> Callable:
                async def patched_a_gen(*args: Any, **kwargs: Any) -> Any:
                    aid = self._get_or_spawn(ag)
                    if getattr(ag, "code_execution_config", None):
                        self._emitter.state(aid, "tool", "Preparing code execution...")
                    else:
                        self._emitter.state(
                            aid, "thinking", f"{self._agent_name(ag)} generating reply..."
                        )
                    result = await orig(*args, **kwargs)
                    if isinstance(result, dict):
                        self._extract_tool_calls(result, aid)
                    self._emitter.state(aid, "writing", "Reply ready")
                    return result

                return patched_a_gen

            agent.a_generate_reply = _make_a_gen(agent, orig_a_gen)

        # ── initiate_chat ─────────────────────────────────────────────────
        if hasattr(agent, "initiate_chat"):
            orig_chat = agent.initiate_chat

            def _make_initiate(ag: Any, orig: Callable) -> Callable:
                def patched_initiate_chat(
                    recipient: Any,
                    *args: Any,
                    **kwargs: Any,
                ) -> Any:
                    # Ensure recipient is also tracked
                    if not getattr(recipient, "_arcade_patched", False):
                        self.attach(recipient)
                    aid = self._get_or_spawn(ag)
                    self._emitter.state(aid, "thinking", "Initiating conversation...")
                    try:
                        result = orig(recipient, *args, **kwargs)
                        return result
                    except Exception as exc:
                        self._emitter.state(aid, "error", str(exc)[:200])
                        raise

                return patched_initiate_chat

            agent.initiate_chat = _make_initiate(agent, orig_chat)


# ---------------------------------------------------------------------------
# Public convenience functions
# ---------------------------------------------------------------------------


def wrap_agent(
    agent: Any,
    *,
    gateway_url: str = "http://localhost:47890",
    session_id: str = "autogen-session",
    api_key: Optional[str] = None,
    agent_name_prefix: str = "",
    auto_spawn: bool = True,
    track_tool_calls: bool = True,
    non_blocking: bool = True,
    options: Optional[ArcadeAutoGenOptions] = None,
) -> ArcadeAutoGenAdapter:
    """Wrap a single AutoGen agent with Agent Arcade telemetry.

    Args:
        agent: An AutoGen ``ConversableAgent`` (or duck-typed equivalent).
        gateway_url: URL of the Agent Arcade gateway.
        session_id: Unique session identifier.
        api_key: Optional Bearer token for the gateway.
        agent_name_prefix: Prefix prepended to agent names in the dashboard.
        auto_spawn: Automatically emit ``agent.spawn`` on first contact.
        track_tool_calls: Emit ``agent.tool`` for function/tool calls.
        non_blocking: Use background threads for HTTP sends.
        options: Pre-built :class:`ArcadeAutoGenOptions`; overrides all other
            keyword arguments when provided.

    Returns:
        The :class:`ArcadeAutoGenAdapter` instance.  Call
        :meth:`~ArcadeAutoGenAdapter.disconnect` when the session ends.

    Example::

        from autogen import AssistantAgent
        from agent_arcade_autogen import wrap_agent

        assistant = AssistantAgent("coder", llm_config={"model": "gpt-4o"})
        adapter = wrap_agent(assistant, session_id="coding-demo")
        # ... run conversation ...
        adapter.disconnect()
    """
    if options is None:
        options = ArcadeAutoGenOptions(
            gateway_url=gateway_url,
            session_id=session_id,
            api_key=api_key,
            agent_name_prefix=agent_name_prefix,
            auto_spawn=auto_spawn,
            track_tool_calls=track_tool_calls,
            non_blocking=non_blocking,
        )
    adapter = ArcadeAutoGenAdapter(options)
    adapter.attach(agent)
    return adapter


def wrap_agents(
    agents: List[Any],
    *,
    gateway_url: str = "http://localhost:47890",
    session_id: str = "autogen-session",
    api_key: Optional[str] = None,
    agent_name_prefix: str = "",
    auto_spawn: bool = True,
    track_tool_calls: bool = True,
    non_blocking: bool = True,
    options: Optional[ArcadeAutoGenOptions] = None,
) -> ArcadeAutoGenAdapter:
    """Wrap a list of AutoGen agents with Agent Arcade telemetry.

    All agents share the same session and are linked when they exchange
    messages.

    Args:
        agents: A list of AutoGen agent instances.
        gateway_url: URL of the Agent Arcade gateway.
        session_id: Unique session identifier.
        api_key: Optional Bearer token for the gateway.
        agent_name_prefix: Prefix prepended to agent names in the dashboard.
        auto_spawn: Automatically emit ``agent.spawn`` on first contact.
        track_tool_calls: Emit ``agent.tool`` for function/tool calls.
        non_blocking: Use background threads for HTTP sends.
        options: Pre-built :class:`ArcadeAutoGenOptions`; overrides all other
            keyword arguments when provided.

    Returns:
        The :class:`ArcadeAutoGenAdapter` instance.  Call
        :meth:`~ArcadeAutoGenAdapter.disconnect` when the session ends.

    Example::

        from autogen import AssistantAgent, UserProxyAgent
        from agent_arcade_autogen import wrap_agents

        assistant = AssistantAgent("coder", llm_config={"model": "gpt-4o"})
        executor  = UserProxyAgent("executor", code_execution_config={"work_dir": "coding"})

        adapter = wrap_agents(
            [assistant, executor],
            gateway_url="http://localhost:47890",
            session_id="coding-session",
        )
        executor.initiate_chat(assistant, message="Write hello world in Python")
        adapter.disconnect()
    """
    if options is None:
        options = ArcadeAutoGenOptions(
            gateway_url=gateway_url,
            session_id=session_id,
            api_key=api_key,
            agent_name_prefix=agent_name_prefix,
            auto_spawn=auto_spawn,
            track_tool_calls=track_tool_calls,
            non_blocking=non_blocking,
        )
    adapter = ArcadeAutoGenAdapter(options)
    adapter.attach_all(agents)
    return adapter
