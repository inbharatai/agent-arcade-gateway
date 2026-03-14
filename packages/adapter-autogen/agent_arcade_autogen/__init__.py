"""
agent-arcade-autogen -- AutoGen adapter for Agent Arcade

Auto-instruments AutoGen multi-agent conversations to emit Agent Arcade
telemetry for real-time visualization in the pixel-art dashboard.

Usage:
    from autogen import AssistantAgent, UserProxyAgent
    from agent_arcade_autogen import wrap_autogen_agents

    assistant = AssistantAgent("coder", llm_config={...})
    user_proxy = UserProxyAgent("executor", code_execution_config={...})

    wrap_autogen_agents(
        [assistant, user_proxy],
        gateway_url="http://localhost:8787",
        session_id="autogen-demo",
    )
    user_proxy.initiate_chat(assistant, message="Write a hello world")
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Union
from urllib.request import Request, urlopen
from urllib.error import URLError

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1


def _ts() -> int:
    return int(time.time() * 1000)


def _uid() -> str:
    return f"ag_{uuid.uuid4().hex[:12]}"


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

    def state(self, agent_id: str, state: str, label: str = "") -> None:
        self.emit("agent.state", agent_id, {"state": state, "label": label})

    def tool(self, agent_id: str, tool_name: str, label: str = "") -> None:
        self.emit("agent.tool", agent_id, {"name": tool_name, "label": label})

    def message(self, agent_id: str, text: str) -> None:
        self.emit("agent.message", agent_id, {"text": text[:500]})

    def link(self, parent_id: str, child_id: str) -> None:
        self.emit("agent.link", child_id, {"parentAgentId": parent_id, "childAgentId": child_id})

    def end(self, agent_id: str, reason: str = "Completed", success: bool = True) -> None:
        self.emit("agent.end", agent_id, {"reason": reason, "success": success})

    def session_start(self, name: str = "") -> None:
        self.emit("session.start", "session", {"name": name})

    def session_end(self, reason: str = "Complete") -> None:
        self.emit("session.end", "session", {"reason": reason})


# ---------------------------------------------------------------------------
# AutoGen Hook
# ---------------------------------------------------------------------------

class ArcadeAutoGenHook:
    """
    Hook into AutoGen's message passing to emit Agent Arcade telemetry.

    Tracks:
    - Assistant agent replies -> writing state
    - User proxy auto-replies -> thinking state
    - Code execution -> tool events
    - Function calls -> tool events
    - Group chat messages -> message events
    - Conversation turns and completion
    """

    def __init__(self, emitter: _ArcadeEmitter) -> None:
        self._emitter = emitter
        self._agent_ids: Dict[str, str] = {}
        self._turn_count = 0

    def _get_agent_id(self, agent: Any) -> str:
        """Get or create an Arcade agent ID for an AutoGen agent."""
        name = getattr(agent, "name", str(id(agent)))
        if name not in self._agent_ids:
            aid = _uid()
            role = "assistant"
            if hasattr(agent, "_is_termination_msg"):
                role = "user-proxy"
            elif hasattr(agent, "system_message"):
                role = "assistant"
            self._emitter.spawn(aid, name, role)
            self._agent_ids[name] = aid
        return self._agent_ids[name]

    def on_send(self, sender: Any, receiver: Any, message: Any) -> None:
        """Called when a message is sent between agents."""
        sender_id = self._get_agent_id(sender)
        receiver_id = self._get_agent_id(receiver)
        self._turn_count += 1

        # Link sender to receiver
        self._emitter.link(sender_id, receiver_id)

        # Determine message content
        if isinstance(message, dict):
            content = message.get("content", "")
            func_call = message.get("function_call")
            tool_calls = message.get("tool_calls")

            if func_call:
                func_name = func_call.get("name", "function")
                self._emitter.tool(sender_id, func_name, str(func_call.get("arguments", ""))[:200])
                self._emitter.state(sender_id, "tool", f"Calling {func_name}")

            if tool_calls:
                for tc in tool_calls:
                    if isinstance(tc, dict):
                        func = tc.get("function", {})
                        name = func.get("name", "tool")
                        self._emitter.tool(sender_id, name, str(func.get("arguments", ""))[:200])
                        self._emitter.state(sender_id, "tool", f"Calling {name}")
        elif isinstance(message, str):
            content = message
        else:
            content = str(message)

        if content:
            self._emitter.message(sender_id, str(content)[:500])

    def on_generate_reply(self, agent: Any) -> None:
        """Called when an agent starts generating a reply."""
        aid = self._get_agent_id(agent)
        name = getattr(agent, "name", "Agent")

        # Detect if this is a user proxy (code execution) or assistant (LLM)
        if hasattr(agent, "code_execution_config") and agent.code_execution_config:
            self._emitter.state(aid, "tool", "Executing code...")
            self._emitter.tool(aid, "code_executor", "Running generated code")
        else:
            self._emitter.state(aid, "thinking", f"{name} reasoning...")

    def on_reply_generated(self, agent: Any, reply: Any) -> None:
        """Called when an agent finishes generating a reply."""
        aid = self._get_agent_id(agent)
        self._emitter.state(aid, "writing", "Reply generated")

    def on_code_execution(self, agent: Any, code: str, result: str = "") -> None:
        """Called when code is executed by a user proxy."""
        aid = self._get_agent_id(agent)
        self._emitter.tool(aid, "code_executor", code[:200])
        if result:
            self._emitter.message(aid, f"Output: {result[:300]}")

    def on_conversation_end(self, agents: List[Any], reason: str = "Complete") -> None:
        """Called when a conversation ends."""
        for agent in agents:
            if getattr(agent, "name", "") in self._agent_ids:
                aid = self._agent_ids[getattr(agent, "name", "")]
                self._emitter.end(aid, reason=f"{reason} ({self._turn_count} turns)", success=True)
        self._emitter.session_end(reason)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def wrap_autogen_agents(
    agents: List[Any],
    gateway_url: str = "http://localhost:8787",
    session_id: str = "autogen-session",
    auth_token: Optional[str] = None,
) -> ArcadeAutoGenHook:
    """
    Wrap a list of AutoGen agents with Agent Arcade telemetry.

    Monkey-patches the `generate_reply`, `send`, and `receive` methods
    to emit telemetry events. All original behavior is preserved.

    Args:
        agents: List of AutoGen agent instances
        gateway_url: Agent Arcade gateway URL
        session_id: Session identifier
        auth_token: Optional authentication token

    Returns:
        ArcadeAutoGenHook instance for manual event control

    Example:
        from autogen import AssistantAgent, UserProxyAgent
        from agent_arcade_autogen import wrap_autogen_agents

        assistant = AssistantAgent("coder", llm_config={...})
        user_proxy = UserProxyAgent("executor")

        hook = wrap_autogen_agents(
            [assistant, user_proxy],
            gateway_url="http://localhost:8787",
            session_id="coding-session",
        )

        user_proxy.initiate_chat(assistant, message="Write hello world in Python")
    """
    emitter = _ArcadeEmitter(gateway_url, session_id, auth_token)
    hook = ArcadeAutoGenHook(emitter)

    emitter.session_start(f"AutoGen Session ({len(agents)} agents)")

    for agent in agents:
        # Patch send method
        if hasattr(agent, "send"):
            original_send = agent.send

            def make_send_patch(ag: Any, orig: Callable) -> Callable:
                def patched_send(message: Any, recipient: Any, *args: Any, **kwargs: Any) -> Any:
                    hook.on_send(ag, recipient, message)
                    return orig(message, recipient, *args, **kwargs)
                return patched_send

            agent.send = make_send_patch(agent, original_send)

        # Patch receive method
        if hasattr(agent, "receive"):
            original_receive = agent.receive

            def make_receive_patch(ag: Any, orig: Callable) -> Callable:
                def patched_receive(message: Any, sender: Any, *args: Any, **kwargs: Any) -> Any:
                    hook.on_generate_reply(ag)
                    result = orig(message, sender, *args, **kwargs)
                    hook.on_reply_generated(ag, result)
                    return result
                return patched_receive

            agent.receive = make_receive_patch(agent, original_receive)

        # Patch generate_reply if it exists
        if hasattr(agent, "generate_reply"):
            original_gen = agent.generate_reply

            def make_gen_patch(ag: Any, orig: Callable) -> Callable:
                def patched_gen(*args: Any, **kwargs: Any) -> Any:
                    hook.on_generate_reply(ag)
                    result = orig(*args, **kwargs)
                    hook.on_reply_generated(ag, result)
                    return result
                return patched_gen

            agent.generate_reply = make_gen_patch(agent, original_gen)

    return hook


class ArcadeGroupChat:
    """
    Extended GroupChat wrapper with built-in Agent Arcade telemetry.

    Wraps AutoGen's GroupChat and GroupChatManager to automatically
    emit telemetry for all agent interactions.

    Usage:
        from autogen import AssistantAgent, GroupChat, GroupChatManager
        from agent_arcade_autogen import ArcadeGroupChat

        agents = [agent1, agent2, agent3]
        arcade_gc = ArcadeGroupChat(
            agents=agents,
            gateway_url="http://localhost:8787",
            session_id="group-chat",
        )
        result = arcade_gc.run("Solve this problem together")
    """

    def __init__(
        self,
        agents: List[Any],
        gateway_url: str = "http://localhost:8787",
        session_id: str = "group-chat",
        auth_token: Optional[str] = None,
        max_round: int = 10,
        **group_chat_kwargs: Any,
    ) -> None:
        self.agents = agents
        self.gateway_url = gateway_url
        self.session_id = session_id
        self.max_round = max_round
        self.hook = wrap_autogen_agents(agents, gateway_url, session_id, auth_token)
        self._group_chat_kwargs = group_chat_kwargs

    def run(self, message: str, sender: Optional[Any] = None) -> Any:
        """
        Start the group chat with an initial message.

        Args:
            message: The initial message to start the conversation
            sender: The agent that sends the initial message (default: first agent)

        Returns:
            The group chat result
        """
        try:
            from autogen import GroupChat, GroupChatManager
        except ImportError:
            raise ImportError("AutoGen not installed. Run: pip install pyautogen")

        group_chat = GroupChat(
            agents=self.agents,
            messages=[],
            max_round=self.max_round,
            **self._group_chat_kwargs,
        )

        manager = GroupChatManager(groupchat=group_chat)
        initiator = sender or self.agents[0]

        try:
            result = initiator.initiate_chat(manager, message=message)
            self.hook.on_conversation_end(self.agents, "Complete")
            return result
        except Exception as e:
            self.hook.on_conversation_end(self.agents, f"Error: {str(e)[:100]}")
            raise
