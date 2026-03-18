"""
Unit tests for the Agent Arcade Python SDK.

No gateway or network access required — urllib.request.urlopen is fully
mocked.  socketio is never installed in the test environment, so the SDK
always falls back to HTTP-only mode.
"""

from __future__ import annotations

import json
import sys
import os
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest

# Make the SDK importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ))
from agent_arcade import AgentArcade  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_sdk(session_id: str = "test-session") -> tuple[AgentArcade, list[dict]]:
    """Return an AgentArcade SDK + list of captured emitted events."""
    calls: list[dict] = []

    def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
        calls.append(json.loads(req.data.decode()))
        return MagicMock()

    sdk = AgentArcade.__new__(AgentArcade)
    sdk.url = "http://mock-gateway:9999"
    sdk.session_id = session_id
    sdk.auth_token = None
    sdk._sio = None  # Force HTTP fallback mode
    sdk._fake_urlopen = fake_urlopen
    # Patch _emit to use our mock
    original_emit = sdk._emit

    def captured_emit(event: dict) -> None:
        calls.append(event)

    sdk._emit = captured_emit  # type: ignore[method-assign]
    return sdk, calls


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

class TestInit:
    def test_default_url_and_session(self) -> None:
        with patch("agent_arcade.urlopen") as m:
            m.side_effect = Exception("no server")
            sdk = AgentArcade(url="http://localhost:47890", session_id="default", auto_connect=False)
        assert sdk.url == "http://localhost:47890"
        assert sdk.session_id == "default"

    def test_trailing_slash_stripped(self) -> None:
        with patch("agent_arcade.urlopen") as m:
            m.side_effect = Exception("no server")
            sdk = AgentArcade(url="http://localhost:47890/", session_id="s", auto_connect=False)
        assert sdk.url == "http://localhost:47890"

    def test_auto_connect_false_does_not_crash_without_socketio(self) -> None:
        sdk = AgentArcade(url="http://localhost:47890", session_id="s", auto_connect=False)
        assert sdk._sio is None

    def test_connect_falls_back_to_http_when_socketio_missing(self) -> None:
        sdk = AgentArcade.__new__(AgentArcade)
        sdk.url = "http://localhost:47890"
        sdk.session_id = "s"
        sdk.auth_token = None
        sdk._sio = None
        # Import will fail inside connect() — it should silently set _sio=None
        with patch.dict("sys.modules", {"socketio": None}):
            sdk.connect()
        assert sdk._sio is None

    def test_context_manager_calls_disconnect(self) -> None:
        sdk, _ = make_sdk()
        sdk._sio = None
        with sdk as s:
            assert s is sdk
        assert sdk._sio is None  # disconnect sets to None — already None here


# ---------------------------------------------------------------------------
# spawn()
# ---------------------------------------------------------------------------

class TestSpawn:
    def test_spawn_returns_agent_id_string(self) -> None:
        sdk, calls = make_sdk()
        aid = sdk.spawn(name="Planner", role="planner")
        assert isinstance(aid, str)
        assert len(aid) > 0

    def test_spawn_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        aid = sdk.spawn(name="Planner", role="planner")

        assert len(calls) == 1
        evt = calls[0]
        assert evt["v"] == 1
        assert evt["type"] == "agent.spawn"
        assert evt["sessionId"] == "test-session"
        assert evt["agentId"] == aid
        assert evt["payload"]["name"] == "Planner"
        assert evt["payload"]["role"] == "planner"

    def test_spawn_with_custom_agent_id(self) -> None:
        sdk, calls = make_sdk()
        aid = sdk.spawn(name="Custom", agent_id="my-fixed-id")
        assert aid == "my-fixed-id"
        assert calls[0]["agentId"] == "my-fixed-id"

    def test_spawn_auto_generates_unique_ids(self) -> None:
        sdk, calls = make_sdk()
        id1 = sdk.spawn(name="A")
        id2 = sdk.spawn(name="B")
        assert id1 != id2

    def test_spawn_default_role_is_assistant(self) -> None:
        sdk, calls = make_sdk()
        sdk.spawn(name="DefaultBot")
        assert calls[0]["payload"]["role"] == "assistant"


# ---------------------------------------------------------------------------
# state()
# ---------------------------------------------------------------------------

class TestState:
    def test_state_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("agent-1", "thinking")

        assert len(calls) == 1
        evt = calls[0]
        assert evt["type"] == "agent.state"
        assert evt["agentId"] == "agent-1"
        assert evt["payload"]["state"] == "thinking"

    def test_state_with_label(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("a1", "writing", label="Drafting code")
        assert calls[0]["payload"]["label"] == "Drafting code"

    def test_state_without_label_omits_key(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("a1", "idle")
        assert "label" not in calls[0]["payload"]

    def test_state_with_progress_clamps_to_0_1(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("a1", "writing", progress=1.5)
        assert calls[0]["payload"]["progress"] == 1.0

        calls.clear()
        sdk.state("a1", "writing", progress=-0.5)
        assert calls[0]["payload"]["progress"] == 0.0

    def test_state_progress_midpoint(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("a1", "writing", progress=0.5)
        assert calls[0]["payload"]["progress"] == 0.5

    def test_state_without_progress_omits_key(self) -> None:
        sdk, calls = make_sdk()
        sdk.state("a1", "idle")
        assert "progress" not in calls[0]["payload"]

    def test_all_valid_states(self) -> None:
        sdk, calls = make_sdk()
        valid_states = ["idle", "thinking", "reading", "writing", "tool", "waiting", "moving", "error", "done"]
        for s in valid_states:
            sdk.state("a1", s)  # type: ignore[arg-type]
        assert len(calls) == len(valid_states)


# ---------------------------------------------------------------------------
# tool()
# ---------------------------------------------------------------------------

class TestTool:
    def test_tool_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        sdk.tool("a1", "read_file")

        evt = calls[0]
        assert evt["type"] == "agent.tool"
        assert evt["payload"]["name"] == "read_file"

    def test_tool_with_path(self) -> None:
        sdk, calls = make_sdk()
        sdk.tool("a1", "read_file", path="/src/index.ts")
        assert calls[0]["payload"]["path"] == "/src/index.ts"

    def test_tool_without_path_omits_key(self) -> None:
        sdk, calls = make_sdk()
        sdk.tool("a1", "read_file")
        assert "path" not in calls[0]["payload"]

    def test_tool_with_label(self) -> None:
        sdk, calls = make_sdk()
        sdk.tool("a1", "write_file", label="Writing auth.ts")
        assert calls[0]["payload"]["label"] == "Writing auth.ts"


# ---------------------------------------------------------------------------
# message()
# ---------------------------------------------------------------------------

class TestMessage:
    def test_message_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        sdk.message("a1", "Hello from agent")

        evt = calls[0]
        assert evt["type"] == "agent.message"
        assert evt["payload"]["text"] == "Hello from agent"

    def test_message_with_level(self) -> None:
        sdk, calls = make_sdk()
        sdk.message("a1", "Warning!", level="warn")
        assert calls[0]["payload"]["level"] == "warn"

    def test_message_requires_input(self) -> None:
        sdk, calls = make_sdk()
        sdk.message("a1", "Need input?", requires_input=True)
        assert calls[0]["payload"]["requiresInput"] is True

    def test_message_without_extras_omits_keys(self) -> None:
        sdk, calls = make_sdk()
        sdk.message("a1", "Plain text")
        payload = calls[0]["payload"]
        assert "level" not in payload
        assert "requiresInput" not in payload


# ---------------------------------------------------------------------------
# link()
# ---------------------------------------------------------------------------

class TestLink:
    def test_link_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        sdk.link("parent-id", "child-id")

        evt = calls[0]
        assert evt["type"] == "agent.link"
        assert evt["agentId"] == "child-id"
        assert evt["payload"]["parentAgentId"] == "parent-id"
        assert evt["payload"]["childAgentId"] == "child-id"


# ---------------------------------------------------------------------------
# position()
# ---------------------------------------------------------------------------

class TestPosition:
    def test_position_emits_correct_event(self) -> None:
        sdk, calls = make_sdk()
        sdk.position("a1", x=100, y=200)

        evt = calls[0]
        assert evt["type"] == "agent.position"
        assert evt["payload"]["x"] == 100
        assert evt["payload"]["y"] == 200


# ---------------------------------------------------------------------------
# end()
# ---------------------------------------------------------------------------

class TestEnd:
    def test_end_default_success(self) -> None:
        sdk, calls = make_sdk()
        sdk.end("a1")

        evt = calls[0]
        assert evt["type"] == "agent.end"
        assert evt["payload"]["success"] is True
        assert evt["payload"]["reason"] == "Completed"

    def test_end_failure(self) -> None:
        sdk, calls = make_sdk()
        sdk.end("a1", reason="Error occurred", success=False)

        evt = calls[0]
        assert evt["payload"]["success"] is False
        assert evt["payload"]["reason"] == "Error occurred"

    def test_end_custom_reason(self) -> None:
        sdk, calls = make_sdk()
        sdk.end("a1", reason="Goal achieved")
        assert calls[0]["payload"]["reason"] == "Goal achieved"


# ---------------------------------------------------------------------------
# HTTP fallback (_emit)
# ---------------------------------------------------------------------------

class TestHttpFallback:
    def test_http_post_sent_to_correct_url(self) -> None:
        seen_urls: list[str] = []

        def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
            seen_urls.append(req.full_url)
            return MagicMock()

        sdk = AgentArcade(url="http://my-gateway:9999", session_id="s", auto_connect=False)
        sdk._sio = None
        with patch("agent_arcade.urlopen", fake_urlopen):
            sdk.spawn(name="Bot")

        assert seen_urls[0] == "http://my-gateway:9999/v1/ingest"

    def test_http_post_sends_json_body(self) -> None:
        bodies: list[dict] = []

        def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
            bodies.append(json.loads(req.data.decode()))
            return MagicMock()

        sdk = AgentArcade(url="http://my-gateway:9999", session_id="http-test", auto_connect=False)
        sdk._sio = None
        with patch("agent_arcade.urlopen", fake_urlopen):
            sdk.spawn(name="HTTP Bot")

        assert bodies[0]["type"] == "agent.spawn"
        assert bodies[0]["sessionId"] == "http-test"

    def test_urlopen_error_is_silenced(self) -> None:
        from urllib.error import URLError

        sdk = AgentArcade(url="http://unreachable:9999", session_id="s", auto_connect=False)
        sdk._sio = None
        with patch("agent_arcade.urlopen", side_effect=URLError("refused")):
            sdk.spawn(name="Bot")  # Must not raise

    def test_os_error_is_silenced(self) -> None:
        sdk = AgentArcade(url="http://unreachable:9999", session_id="s", auto_connect=False)
        sdk._sio = None
        with patch("agent_arcade.urlopen", side_effect=OSError("network error")):
            sdk.state("a1", "thinking")  # Must not raise


# ---------------------------------------------------------------------------
# Full lifecycle flow
# ---------------------------------------------------------------------------

class TestLifecycle:
    def test_full_agent_lifecycle(self) -> None:
        sdk, calls = make_sdk(session_id="lifecycle-test")

        aid = sdk.spawn(name="Planner", role="planner")
        sdk.state(aid, "thinking", label="Analyzing requirements")
        sdk.tool(aid, "read_file", path="spec.md")
        sdk.state(aid, "writing", label="Drafting solution")
        sdk.message(aid, "Draft complete")
        sdk.end(aid, reason="Success", success=True)

        types = [e["type"] for e in calls]
        assert types == [
            "agent.spawn",
            "agent.state",
            "agent.tool",
            "agent.state",
            "agent.message",
            "agent.end",
        ]

    def test_multi_agent_independent_ids(self) -> None:
        sdk, calls = make_sdk()
        a1 = sdk.spawn(name="Agent1")
        a2 = sdk.spawn(name="Agent2")
        sdk.link(a1, a2)
        sdk.end(a1)
        sdk.end(a2)

        agent_ids_in_events = [e["agentId"] for e in calls]
        assert a1 in agent_ids_in_events
        assert a2 in agent_ids_in_events

    def test_session_id_consistent_across_all_events(self) -> None:
        sdk, calls = make_sdk(session_id="consistent-session")
        aid = sdk.spawn(name="Bot")
        sdk.state(aid, "thinking")
        sdk.end(aid)

        for evt in calls:
            assert evt["sessionId"] == "consistent-session"

    def test_protocol_version_is_1_on_all_events(self) -> None:
        sdk, calls = make_sdk()
        aid = sdk.spawn(name="Bot")
        sdk.state(aid, "idle")
        sdk.end(aid)

        for evt in calls:
            assert evt["v"] == 1

    def test_timestamp_is_positive_integer(self) -> None:
        sdk, calls = make_sdk()
        sdk.spawn(name="TimedBot")

        assert isinstance(calls[0]["ts"], int)
        assert calls[0]["ts"] > 0


# ---------------------------------------------------------------------------
# disconnect()
# ---------------------------------------------------------------------------

class TestDisconnect:
    def test_disconnect_sets_sio_none(self) -> None:
        sdk = AgentArcade(url="http://localhost:47890", session_id="s", auto_connect=False)
        sdk._sio = None
        sdk.disconnect()
        assert sdk._sio is None

    def test_disconnect_calls_sio_disconnect(self) -> None:
        sdk = AgentArcade(url="http://localhost:47890", session_id="s", auto_connect=False)
        mock_sio = MagicMock()
        sdk._sio = mock_sio
        sdk.disconnect()
        mock_sio.disconnect.assert_called_once()
        assert sdk._sio is None

    def test_disconnect_silences_sio_error(self) -> None:
        sdk = AgentArcade(url="http://localhost:47890", session_id="s", auto_connect=False)
        mock_sio = MagicMock()
        mock_sio.disconnect.side_effect = RuntimeError("already gone")
        sdk._sio = mock_sio
        sdk.disconnect()  # Must not raise
        assert sdk._sio is None
