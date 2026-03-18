"""
Unit tests for the Agent Arcade AutoGen adapter.

No AutoGen installation required — all agents are plain Python objects
(duck-typed).  HTTP is fully mocked; non_blocking=False is used throughout
so every emit is synchronous.
"""

from __future__ import annotations

import json
import sys
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Make the adapter importable from the src directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from arcade_adapter import (  # noqa: E402
    ArcadeAutoGenAdapter,
    ArcadeAutoGenOptions,
    _ArcadeEmitter,
    wrap_agent,
    wrap_agents,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SYNC_OPTS = ArcadeAutoGenOptions(
    gateway_url="http://mock-gateway:9999",
    session_id="test-session",
    non_blocking=False,
)


def _make_adapter_with_capture() -> tuple[ArcadeAutoGenAdapter, list[dict]]:
    """Return an adapter + captured-events list (synchronous, mocked HTTP)."""
    calls: list[dict] = []
    opts = ArcadeAutoGenOptions(
        gateway_url="http://mock:9999",
        session_id="test-session",
        non_blocking=False,
    )
    adapter = ArcadeAutoGenAdapter(opts)
    # Patch _post directly so all emits are captured
    adapter._emitter._post = lambda event: calls.append(event)
    return adapter, calls


def make_fake_agent(name: str = "Assistant", has_code_exec: bool = False) -> MagicMock:
    """Create a duck-typed AutoGen-like agent."""
    agent = MagicMock()
    agent.name = name
    agent._arcade_patched = False
    agent.code_execution_config = {"work_dir": "."} if has_code_exec else None
    agent._is_termination_msg = None
    agent.system_message = "You are a helpful assistant."
    agent.send = MagicMock(return_value=None)
    agent.receive = MagicMock(return_value=None)
    agent.generate_reply = MagicMock(return_value={"content": "Hello!"})
    agent.initiate_chat = MagicMock(return_value=None)
    return agent


# ---------------------------------------------------------------------------
# ArcadeAutoGenOptions defaults
# ---------------------------------------------------------------------------

class TestOptions:
    def test_defaults(self) -> None:
        opts = ArcadeAutoGenOptions()
        assert opts.gateway_url == "http://localhost:47890"
        assert opts.session_id == "autogen-session"
        assert opts.agent_name_prefix == ""
        assert opts.auto_spawn is True
        assert opts.track_tool_calls is True
        assert opts.non_blocking is True

    def test_custom_values(self) -> None:
        opts = ArcadeAutoGenOptions(
            gateway_url="http://custom:1234",
            session_id="my-session",
            agent_name_prefix="Bot",
            non_blocking=False,
        )
        assert opts.agent_name_prefix == "Bot"
        assert opts.non_blocking is False


# ---------------------------------------------------------------------------
# _ArcadeEmitter
# ---------------------------------------------------------------------------

class TestEmitter:
    # The AutoGen _ArcadeEmitter imports urlopen inside __init__ and stores it
    # as self._urlopen — so we patch the instance attribute directly, not the module.

    def _make_emitter(self, session_id: str = "s", api_key: str | None = None) -> tuple[_ArcadeEmitter, list[dict]]:
        calls: list[dict] = []
        opts = ArcadeAutoGenOptions(
            gateway_url="http://mock:9999",
            session_id=session_id,
            api_key=api_key,
            non_blocking=False,
        )
        em = _ArcadeEmitter(opts)
        em._urlopen = lambda req, timeout=5: calls.append(json.loads(req.data.decode())) or MagicMock()  # type: ignore
        return em, calls

    def test_spawn_event_structure(self) -> None:
        em, calls = self._make_emitter(session_id="s")
        em.spawn("agent-1", "TestBot", "assistant")

        assert len(calls) == 1
        evt = calls[0]
        assert evt["v"] == 1
        assert evt["type"] == "agent.spawn"
        assert evt["sessionId"] == "s"
        assert evt["agentId"] == "agent-1"
        assert evt["payload"]["name"] == "TestBot"

    def test_state_event(self) -> None:
        em, calls = self._make_emitter()
        em.state("a1", "thinking", label="Reasoning...")

        evt = calls[0]
        assert evt["type"] == "agent.state"
        assert evt["payload"]["state"] == "thinking"
        assert evt["payload"]["label"] == "Reasoning..."

    def test_urlopen_error_silenced(self) -> None:
        from urllib.error import URLError
        opts = ArcadeAutoGenOptions(gateway_url="http://bad:9999", session_id="s", non_blocking=False)
        em = _ArcadeEmitter(opts)
        em._urlopen = MagicMock(side_effect=URLError("refused"))  # type: ignore
        em.spawn("a1", "Bot")  # Must not raise

    def test_api_key_header(self) -> None:
        headers_seen: list[dict] = []

        def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
            headers_seen.append(dict(req.headers))
            return MagicMock()

        opts = ArcadeAutoGenOptions(
            gateway_url="http://mock:9999",
            session_id="s",
            api_key="tok-abc",
            non_blocking=False,
        )
        em = _ArcadeEmitter(opts)
        em._urlopen = fake_urlopen  # type: ignore
        em.spawn("a1", "Bot")

        assert "Authorization" in headers_seen[0]
        assert "tok-abc" in headers_seen[0]["Authorization"]


# ---------------------------------------------------------------------------
# ArcadeAutoGenAdapter.attach
# ---------------------------------------------------------------------------

class TestAttach:
    def test_attach_spawns_agent(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("Coder")
        adapter.attach(agent)

        assert any(e["type"] == "agent.spawn" for e in calls)
        spawn_evt = next(e for e in calls if e["type"] == "agent.spawn")
        assert spawn_evt["payload"]["name"] == "Coder"

    def test_attach_twice_spawns_once(self) -> None:
        """Double-attach the same agent — spawn should fire only once."""
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("Analyst")
        adapter.attach(agent)
        agent._arcade_patched = True  # Mark as already patched
        adapter.attach(agent)

        spawn_count = sum(1 for e in calls if e["type"] == "agent.spawn")
        assert spawn_count == 1

    def test_attach_with_prefix(self) -> None:
        calls: list[dict] = []
        opts = ArcadeAutoGenOptions(
            gateway_url="http://mock:9999",
            session_id="s",
            agent_name_prefix="MyBot",
            non_blocking=False,
        )
        adapter = ArcadeAutoGenAdapter(opts)
        adapter._emitter._post = lambda event: calls.append(event)
        agent = make_fake_agent("Writer")
        adapter.attach(agent)

        spawn_evt = next(e for e in calls if e["type"] == "agent.spawn")
        assert spawn_evt["payload"]["name"] == "MyBot:Writer"

    def test_attach_all(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agents = [make_fake_agent(f"Agent{i}") for i in range(3)]
        ids = adapter.attach_all(agents)

        assert len(ids) == 3
        spawn_count = sum(1 for e in calls if e["type"] == "agent.spawn")
        assert spawn_count == 3

    def test_attach_emits_session_start(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("Planner")
        adapter.attach(agent)

        assert any(e["type"] == "session.start" for e in calls)

    def test_attach_session_start_only_once(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        adapter.attach(make_fake_agent("A"))
        adapter.attach(make_fake_agent("B"))

        session_starts = sum(1 for e in calls if e["type"] == "session.start")
        assert session_starts == 1


# ---------------------------------------------------------------------------
# Role inference
# ---------------------------------------------------------------------------

class TestRoleInference:
    def test_executor_role_from_code_execution_config(self) -> None:
        agent = make_fake_agent("Executor", has_code_exec=True)
        assert ArcadeAutoGenAdapter._infer_role(agent) == "executor"

    def test_user_proxy_role(self) -> None:
        agent = MagicMock()
        agent.code_execution_config = None
        agent._is_termination_msg = lambda x: False
        agent.system_message = None
        assert ArcadeAutoGenAdapter._infer_role(agent) == "user-proxy"

    def test_assistant_role_default(self) -> None:
        agent = make_fake_agent("Helper")
        agent.code_execution_config = None
        agent._is_termination_msg = None
        agent.system_message = "You are helpful."
        assert ArcadeAutoGenAdapter._infer_role(agent) == "assistant"


# ---------------------------------------------------------------------------
# Patched method behaviour
# ---------------------------------------------------------------------------

class TestPatchedMethods:
    def test_patched_send_emits_message(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        sender = make_fake_agent("Sender")
        receiver = make_fake_agent("Receiver")
        adapter.attach(sender)
        adapter.attach(receiver)
        calls.clear()

        # Call the patched send
        sender.send("Hello there!", receiver)

        assert any(e["type"] == "agent.message" for e in calls)
        msg_evt = next(e for e in calls if e["type"] == "agent.message")
        assert "Hello there!" in msg_evt["payload"]["text"]

    def test_patched_send_emits_waiting_state(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        sender = make_fake_agent("Sender")
        receiver = make_fake_agent("Receiver")
        adapter.attach(sender)
        adapter.attach(receiver)
        calls.clear()

        sender.send("Hi", receiver)

        state_evts = [e for e in calls if e["type"] == "agent.state"]
        states = [e["payload"]["state"] for e in state_evts]
        assert "waiting" in states

    def test_patched_send_increments_turn_count(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        sender = make_fake_agent("S")
        receiver = make_fake_agent("R")
        adapter.attach(sender)
        adapter.attach(receiver)

        sender.send("msg1", receiver)
        sender.send("msg2", receiver)

        assert adapter._turn_count == 2

    def test_patched_receive_emits_thinking_for_non_executor(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("LLMAgent", has_code_exec=False)
        adapter.attach(agent)
        calls.clear()

        sender = make_fake_agent("User")
        agent.receive("Hello", sender)

        state_evts = [e for e in calls if e["type"] == "agent.state"]
        states = [e["payload"]["state"] for e in state_evts]
        assert "thinking" in states

    def test_patched_receive_emits_tool_for_executor(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        executor = make_fake_agent("Executor", has_code_exec=True)
        adapter.attach(executor)
        calls.clear()

        sender = make_fake_agent("Sender")
        executor.receive("run this code", sender)

        state_evts = [e for e in calls if e["type"] == "agent.state"]
        states = [e["payload"]["state"] for e in state_evts]
        assert "tool" in states

    def test_patched_generate_reply_emits_thinking(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("Assistant")
        adapter.attach(agent)
        calls.clear()

        agent.generate_reply()

        state_evts = [e for e in calls if e["type"] == "agent.state"]
        states = [e["payload"]["state"] for e in state_evts]
        assert "thinking" in states

    def test_patched_generate_reply_emits_writing(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("Assistant")
        adapter.attach(agent)
        calls.clear()

        agent.generate_reply()

        states = [e["payload"]["state"] for e in calls if e["type"] == "agent.state"]
        assert "writing" in states

    def test_patched_send_dict_message_emits_content(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        sender = make_fake_agent("Sender")
        receiver = make_fake_agent("Receiver")
        adapter.attach(sender)
        adapter.attach(receiver)
        calls.clear()

        sender.send({"content": "Dict message text", "role": "user"}, receiver)

        msg_evt = next((e for e in calls if e["type"] == "agent.message"), None)
        assert msg_evt is not None
        assert "Dict message text" in msg_evt["payload"]["text"]


# ---------------------------------------------------------------------------
# Tool call extraction
# ---------------------------------------------------------------------------

class TestToolCallExtraction:
    def test_function_call_in_message_emits_tool(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("FnAgent")
        adapter.attach(agent)
        calls.clear()

        message = {
            "content": "calling a function",
            "function_call": {"name": "get_weather", "arguments": '{"city":"NYC"}'},
        }
        adapter._extract_tool_calls(message, adapter._agent_ids["FnAgent"])

        assert any(e["type"] == "agent.tool" for e in calls)
        tool_evt = next(e for e in calls if e["type"] == "agent.tool")
        assert tool_evt["payload"]["name"] == "get_weather"

    def test_tool_calls_list_in_message(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        agent = make_fake_agent("ToolAgent")
        adapter.attach(agent)
        calls.clear()

        message = {
            "tool_calls": [
                {"function": {"name": "search", "arguments": '{"q":"test"}'}},
                {"function": {"name": "summarize", "arguments": '{"text":"..."}'}},
            ]
        }
        adapter._extract_tool_calls(message, adapter._agent_ids["ToolAgent"])

        tool_evts = [e for e in calls if e["type"] == "agent.tool"]
        tool_names = [e["payload"]["name"] for e in tool_evts]
        assert "search" in tool_names
        assert "summarize" in tool_names

    def test_track_tool_calls_false_suppresses_tool_events(self) -> None:
        calls: list[dict] = []
        opts = ArcadeAutoGenOptions(
            gateway_url="http://mock:9999",
            session_id="s",
            track_tool_calls=False,
            non_blocking=False,
        )
        adapter = ArcadeAutoGenAdapter(opts)
        adapter._emitter._post = lambda event: calls.append(event)
        agent = make_fake_agent("NoToolAgent")
        adapter.attach(agent)
        calls.clear()

        message = {"function_call": {"name": "hidden_fn", "arguments": "{}"}}
        adapter._extract_tool_calls(message, adapter._agent_ids["NoToolAgent"])

        assert not any(e["type"] == "agent.tool" for e in calls)


# ---------------------------------------------------------------------------
# disconnect
# ---------------------------------------------------------------------------

class TestDisconnect:
    def test_disconnect_ends_all_agents(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        adapter.attach(make_fake_agent("A1"))
        adapter.attach(make_fake_agent("A2"))
        calls.clear()

        adapter.disconnect()

        end_evts = [e for e in calls if e["type"] == "agent.end"]
        assert len(end_evts) >= 2

    def test_disconnect_emits_session_end(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        adapter.attach(make_fake_agent("Solo"))
        calls.clear()

        adapter.disconnect()

        assert any(e["type"] == "session.end" for e in calls)

    def test_disconnect_clears_agent_ids(self) -> None:
        adapter, calls = _make_adapter_with_capture()
        adapter.attach(make_fake_agent("Gone"))
        adapter.disconnect()
        assert len(adapter._agent_ids) == 0


# ---------------------------------------------------------------------------
# wrap_agent / wrap_agents convenience functions
# ---------------------------------------------------------------------------

class TestWrapFunctions:
    # _ArcadeEmitter imports urlopen inside __init__ — patch urllib.request.urlopen.
    _URLOPEN = "urllib.request.urlopen"

    def test_wrap_agent_returns_adapter(self) -> None:
        agent = make_fake_agent("SingleBot")
        with patch(self._URLOPEN, return_value=MagicMock()):
            adapter = wrap_agent(
                agent,
                gateway_url="http://mock:9999",
                session_id="s",
                non_blocking=False,
            )
        assert isinstance(adapter, ArcadeAutoGenAdapter)

    def test_wrap_agent_attaches_to_agent(self) -> None:
        agent = make_fake_agent("Wrapped")
        with patch(self._URLOPEN, return_value=MagicMock()):
            adapter = wrap_agent(
                agent,
                gateway_url="http://mock:9999",
                session_id="s",
                non_blocking=False,
            )
        assert "Wrapped" in adapter._agent_ids

    def test_wrap_agents_attaches_all(self) -> None:
        agents = [make_fake_agent(f"Bot{i}") for i in range(4)]
        with patch(self._URLOPEN, return_value=MagicMock()):
            adapter = wrap_agents(
                agents,
                gateway_url="http://mock:9999",
                session_id="s",
                non_blocking=False,
            )
        assert len(adapter._agent_ids) == 4

    def test_wrap_agents_with_options_object(self) -> None:
        opts = ArcadeAutoGenOptions(
            gateway_url="http://opts:9999",
            session_id="opts-session",
            non_blocking=False,
        )
        agents = [make_fake_agent("Opts1"), make_fake_agent("Opts2")]
        with patch(self._URLOPEN, return_value=MagicMock()):
            adapter = wrap_agents(agents, options=opts)
        assert adapter._emitter._session_id == "opts-session"
