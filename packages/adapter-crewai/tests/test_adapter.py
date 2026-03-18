"""
Unit tests for the Agent Arcade CrewAI adapter.

No CrewAI installation required — all CrewAI objects are duck-typed using
plain Python classes.  HTTP is fully mocked; non_blocking=False makes every
emit synchronous so we can assert immediately.
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
    ArcadeCrewAICallback,
    ArcadeCrewAIOptions,
    _ArcadeEmitter,
    wrap_crew,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SYNC_OPTS = ArcadeCrewAIOptions(
    gateway_url="http://mock-gateway:9999",
    session_id="test-session",
    non_blocking=False,
)


def _captured_opts() -> tuple[ArcadeCrewAIOptions, list[dict]]:
    """Return options that capture every emitted event synchronously."""
    calls: list[dict] = []

    def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
        calls.append(json.loads(req.data.decode()))
        return MagicMock()

    opts = ArcadeCrewAIOptions(
        gateway_url="http://mock-gateway:9999",
        session_id="test-session",
        non_blocking=False,
    )
    return opts, calls, fake_urlopen


def make_fake_agent(role: str = "Researcher", goal: str = "Find data") -> MagicMock:
    a = MagicMock()
    a.role = role
    a.goal = goal
    return a


def make_fake_step(agent: Any, tool: str = "", thought: str = "") -> MagicMock:
    step = MagicMock()
    step.agent = agent
    step.tool = tool
    step.tool_input = "some input"
    step.thought = thought
    return step


def make_fake_task_output(agent: Any, raw: str = "output text") -> MagicMock:
    to = MagicMock()
    to.agent = agent
    to.task = None
    to.raw_output = raw
    return to


# ---------------------------------------------------------------------------
# ArcadeCrewAIOptions defaults
# ---------------------------------------------------------------------------

class TestOptions:
    def test_defaults(self) -> None:
        opts = ArcadeCrewAIOptions()
        assert opts.gateway_url == "http://localhost:47890"
        assert opts.session_id == "crewai-session"
        assert opts.agent_name_prefix == "Crew"
        assert opts.auto_spawn is True
        assert opts.track_tokens is True
        assert opts.non_blocking is True

    def test_custom_values(self) -> None:
        opts = ArcadeCrewAIOptions(
            gateway_url="http://custom:1234",
            session_id="my-session",
            api_key="secret",
            agent_name_prefix="MyBot",
            non_blocking=False,
        )
        assert opts.gateway_url == "http://custom:1234"
        assert opts.api_key == "secret"
        assert opts.non_blocking is False


# ---------------------------------------------------------------------------
# _ArcadeEmitter
# ---------------------------------------------------------------------------

class TestArcadeEmitter:
    def test_emit_builds_correct_payload(self) -> None:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.spawn("agent-1", "TestAgent", "worker")

        assert len(calls) == 1
        evt = calls[0]
        assert evt["v"] == 1
        assert evt["sessionId"] == "test-session"
        assert evt["agentId"] == "agent-1"
        assert evt["type"] == "agent.spawn"
        assert evt["payload"]["name"] == "TestAgent"
        assert evt["payload"]["role"] == "worker"

    def test_state_emit(self) -> None:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.state("a1", "thinking", label="Processing...", progress=0.5)

        evt = calls[0]
        assert evt["type"] == "agent.state"
        assert evt["payload"]["state"] == "thinking"
        assert evt["payload"]["label"] == "Processing..."
        assert evt["payload"]["progress"] == 0.5

    def test_tool_emit(self) -> None:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.tool("a1", "read_file", label="Reading index.ts")

        evt = calls[0]
        assert evt["type"] == "agent.tool"
        assert evt["payload"]["name"] == "read_file"
        assert evt["payload"]["label"] == "Reading index.ts"

    def test_message_truncates_at_500(self) -> None:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.message("a1", "x" * 600)

        evt = calls[0]
        assert len(evt["payload"]["text"]) == 500

    def test_end_emit(self) -> None:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.end("a1", reason="Done", success=True)

        evt = calls[0]
        assert evt["type"] == "agent.end"
        assert evt["payload"]["success"] is True

    def test_api_key_sent_in_header(self) -> None:
        captured_headers: list[dict] = []

        def fake_urlopen(req: Any, timeout: int = 5) -> MagicMock:
            captured_headers.append(dict(req.headers))
            return MagicMock()

        opts = ArcadeCrewAIOptions(
            gateway_url="http://mock:9999",
            session_id="s",
            api_key="my-secret-token",
            non_blocking=False,
        )
        with patch("arcade_adapter.urlopen", fake_urlopen):
            emitter = _ArcadeEmitter(opts)
            emitter.spawn("a1", "Agent", "worker")

        assert "Authorization" in captured_headers[0]
        assert "my-secret-token" in captured_headers[0]["Authorization"]

    def test_non_blocking_uses_thread(self) -> None:
        """non_blocking=True should not call urlopen on the main thread."""
        opts = ArcadeCrewAIOptions(
            gateway_url="http://mock:9999",
            session_id="s",
            non_blocking=True,
        )
        with patch("arcade_adapter.urlopen") as mock_urlopen:
            emitter = _ArcadeEmitter(opts)
            emitter.spawn("a1", "Agent")
            # urlopen is called in a daemon thread — may not have fired yet,
            # but the emitter should not raise
        # No assertion on call count — just verify no crash

    def test_urlopen_error_is_silenced(self) -> None:
        from urllib.error import URLError

        opts = ArcadeCrewAIOptions(
            gateway_url="http://unreachable:9999",
            session_id="s",
            non_blocking=False,
        )
        with patch("arcade_adapter.urlopen", side_effect=URLError("connection refused")):
            emitter = _ArcadeEmitter(opts)
            # Should not raise
            emitter.spawn("a1", "Agent")


# ---------------------------------------------------------------------------
# ArcadeCrewAICallback — step and task hooks
# ---------------------------------------------------------------------------

class TestCrewAICallback:
    def _make_cb(self) -> tuple[ArcadeCrewAICallback, list[dict]]:
        opts, calls, fake_urlopen = _captured_opts()
        with patch("arcade_adapter.urlopen", fake_urlopen):
            cb = ArcadeCrewAICallback(opts)
        # Patch the emitter's _post directly so all future calls are captured
        cb._emitter._post = lambda event: calls.append(event)
        return cb, calls

    # ── on_step ──────────────────────────────────────────────────────────

    def test_on_step_with_tool_emits_tool_and_state(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Coder")
        step = make_fake_step(agent, tool="write_code", thought="")
        cb.on_step(step)

        types = [e["type"] for e in calls]
        assert "agent.spawn" in types
        assert "agent.tool" in types
        assert "agent.state" in types

        tool_evt = next(e for e in calls if e["type"] == "agent.tool")
        assert tool_evt["payload"]["name"] == "write_code"

        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "tool"

    def test_on_step_with_thought_emits_thinking(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Analyst")
        step = make_fake_step(agent, tool="", thought="Analyzing data patterns")
        cb.on_step(step)

        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "thinking"
        assert "Analyzing" in state_evt["payload"]["label"]

    def test_on_step_without_agent_is_noop(self) -> None:
        cb, calls = self._make_cb()
        step = MagicMock()
        step.agent = None
        cb.on_step(step)
        # No spawn should occur
        assert not any(e["type"] == "agent.spawn" for e in calls)

    def test_on_step_same_agent_not_spawned_twice(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Writer")
        step1 = make_fake_step(agent, tool="draft")
        step2 = make_fake_step(agent, tool="revise")
        cb.on_step(step1)
        cb.on_step(step2)
        spawn_count = sum(1 for e in calls if e["type"] == "agent.spawn")
        assert spawn_count == 1  # same role key — only spawned once

    # ── on_task_output ────────────────────────────────────────────────────

    def test_on_task_output_emits_done_state(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Reviewer")
        to = make_fake_task_output(agent, raw="Great analysis!")
        cb._task_count = 3
        cb.on_task_output(to)

        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "done"

    def test_on_task_output_emits_raw_message(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Writer")
        to = make_fake_task_output(agent, raw="Final output here")
        cb.on_task_output(to)

        msg_evt = next((e for e in calls if e["type"] == "agent.message"), None)
        assert msg_evt is not None
        assert "Final output" in msg_evt["payload"]["text"]

    def test_on_task_output_increments_progress(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Dev")
        cb._task_count = 4
        for i in range(4):
            cb.on_task_output(make_fake_task_output(agent, raw=f"task {i}"))

        assert cb._completed_tasks == 4

    # ── LLM callbacks ─────────────────────────────────────────────────────

    def test_on_llm_start_emits_thinking(self) -> None:
        cb, calls = self._make_cb()
        cb.on_llm_start({"name": "gpt-4o"}, ["Hello"], run_id="run-1")

        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "thinking"

    def test_on_llm_end_emits_token_message(self) -> None:
        cb, calls = self._make_cb()
        cb.on_llm_start({"name": "gpt-4o"}, ["Hello"], run_id="run-1")
        calls.clear()

        response = MagicMock()
        response.llm_output = {"tokenUsage": {"totalTokens": 42, "promptTokens": 10, "completionTokens": 32}}
        cb.on_llm_end(response, run_id="run-1")

        types = [e["type"] for e in calls]
        assert "agent.message" in types
        assert "agent.end" in types

        msg = next(e for e in calls if e["type"] == "agent.message")
        assert "42" in msg["payload"]["text"]

    def test_on_llm_error_emits_error_state_and_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_llm_start({"name": "gpt-4o"}, ["Hello"], run_id="run-2")
        calls.clear()

        cb.on_llm_error(ValueError("rate limit exceeded"), run_id="run-2")

        types = [e["type"] for e in calls]
        assert "agent.state" in types
        assert "agent.end" in types

        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "error"

        end_evt = next(e for e in calls if e["type"] == "agent.end")
        assert end_evt["payload"]["success"] is False

    # ── Chain callbacks ────────────────────────────────────────────────────

    def test_on_chain_start_emits_thinking(self) -> None:
        cb, calls = self._make_cb()
        cb.on_chain_start({"name": "MyChain"}, {"input": "hi"}, run_id="chain-1")
        state_evt = next(e for e in calls if e["type"] == "agent.state")
        assert state_evt["payload"]["state"] == "thinking"

    def test_on_chain_end_calls_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_chain_start({"name": "MyChain"}, {}, run_id="chain-2")
        calls.clear()
        cb.on_chain_end({}, run_id="chain-2")
        assert any(e["type"] == "agent.end" for e in calls)

    def test_on_chain_error_emits_error_and_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_chain_start({"name": "Chain"}, {}, run_id="chain-3")
        calls.clear()
        cb.on_chain_error(RuntimeError("chain failed"), run_id="chain-3")
        types = [e["type"] for e in calls]
        assert "agent.state" in types
        assert "agent.end" in types

    # ── Tool callbacks ─────────────────────────────────────────────────────

    def test_on_tool_start_emits_tool_event(self) -> None:
        cb, calls = self._make_cb()
        cb.on_tool_start({"name": "web_search"}, "query string", run_id="tool-1")
        assert any(e["type"] == "agent.tool" for e in calls)

        tool_evt = next(e for e in calls if e["type"] == "agent.tool")
        assert tool_evt["payload"]["name"] == "web_search"

    def test_on_tool_end_emits_message_and_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_tool_start({"name": "web_search"}, "query", run_id="tool-2")
        calls.clear()
        cb.on_tool_end("Search results here", run_id="tool-2")
        types = [e["type"] for e in calls]
        assert "agent.message" in types
        assert "agent.end" in types

    def test_on_tool_error_emits_error_and_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_tool_start({"name": "web_search"}, "query", run_id="tool-3")
        calls.clear()
        cb.on_tool_error(ConnectionError("timeout"), run_id="tool-3")
        types = [e["type"] for e in calls]
        assert "agent.state" in types
        assert "agent.end" in types
        end_evt = next(e for e in calls if e["type"] == "agent.end")
        assert end_evt["payload"]["success"] is False

    # ── Agent action callbacks ─────────────────────────────────────────────

    def test_on_agent_action_emits_tool_event(self) -> None:
        cb, calls = self._make_cb()
        cb.on_llm_start({"name": "llm"}, ["p"], run_id="agent-run-1")
        calls.clear()

        action = MagicMock()
        action.tool = "code_interpreter"
        action.tool_input = "print('hello')"
        cb.on_agent_action(action, run_id="agent-run-1")

        assert any(e["type"] == "agent.tool" for e in calls)

    def test_on_agent_finish_calls_end(self) -> None:
        cb, calls = self._make_cb()
        cb.on_llm_start({"name": "llm"}, ["p"], run_id="agent-run-2")
        calls.clear()
        cb.on_agent_finish(MagicMock(), run_id="agent-run-2")
        assert any(e["type"] == "agent.end" for e in calls)

    # ── disconnect ─────────────────────────────────────────────────────────

    def test_disconnect_ends_all_agents(self) -> None:
        cb, calls = self._make_cb()
        agent1 = make_fake_agent("Dev")
        agent2 = make_fake_agent("Writer")
        cb.on_step(make_fake_step(agent1, tool="edit"))
        cb.on_step(make_fake_step(agent2, thought="Thinking"))
        calls.clear()
        cb.disconnect()
        end_events = [e for e in calls if e["type"] == "agent.end"]
        assert len(end_events) >= 2

    def test_disconnect_clears_agent_registry(self) -> None:
        cb, calls = self._make_cb()
        agent = make_fake_agent("Solo")
        cb.on_step(make_fake_step(agent, tool="read"))
        cb.disconnect()
        assert len(cb._agent_ids) == 0


# ---------------------------------------------------------------------------
# wrap_crew
# ---------------------------------------------------------------------------

class TestWrapCrew:
    def test_wrap_crew_returns_callback(self) -> None:
        crew = MagicMock()
        crew.tasks = []
        crew.kickoff = MagicMock(return_value="result")

        with patch("arcade_adapter.urlopen") as mock_urlopen:
            mock_urlopen.return_value = MagicMock()
            cb = wrap_crew(crew, gateway_url="http://mock:9999", session_id="s", non_blocking=False)

        assert isinstance(cb, ArcadeCrewAICallback)

    def test_wrap_crew_patches_kickoff(self) -> None:
        crew = MagicMock()
        crew.tasks = [MagicMock(), MagicMock()]
        original_kickoff = MagicMock(return_value="done")
        crew.kickoff = original_kickoff

        calls: list[dict] = []
        with patch("arcade_adapter.urlopen", lambda req, timeout=5: calls.append(json.loads(req.data.decode())) or MagicMock()):
            cb = wrap_crew(crew, gateway_url="http://mock:9999", session_id="wrap-test", non_blocking=False)
            result = crew.kickoff()

        assert result == "done"
        original_kickoff.assert_called_once()

    def test_wrap_crew_emits_session_start(self) -> None:
        crew = MagicMock()
        crew.tasks = []
        crew.name = "Research Crew"
        crew.kickoff = MagicMock(return_value="ok")

        calls: list[dict] = []
        with patch("arcade_adapter.urlopen", lambda req, timeout=5: calls.append(json.loads(req.data.decode())) or MagicMock()):
            cb = wrap_crew(crew, gateway_url="http://mock:9999", session_id="s", non_blocking=False)
            crew.kickoff()

        types = [e["type"] for e in calls]
        assert "session.start" in types

    def test_wrap_crew_emits_session_end_on_success(self) -> None:
        crew = MagicMock()
        crew.tasks = []
        crew.kickoff = MagicMock(return_value="ok")

        calls: list[dict] = []
        with patch("arcade_adapter.urlopen", lambda req, timeout=5: calls.append(json.loads(req.data.decode())) or MagicMock()):
            cb = wrap_crew(crew, gateway_url="http://mock:9999", session_id="s", non_blocking=False)
            crew.kickoff()

        types = [e["type"] for e in calls]
        assert "session.end" in types

    def test_wrap_crew_sets_task_count(self) -> None:
        crew = MagicMock()
        crew.tasks = [MagicMock() for _ in range(5)]
        crew.kickoff = MagicMock(return_value="ok")

        with patch("arcade_adapter.urlopen") as m:
            m.return_value = MagicMock()
            cb = wrap_crew(crew, gateway_url="http://mock:9999", session_id="s", non_blocking=False)
            crew.kickoff()

        assert cb._task_count == 5

    def test_wrap_crew_uses_options_object(self) -> None:
        opts = ArcadeCrewAIOptions(
            gateway_url="http://opts-gateway:9999",
            session_id="opts-session",
            non_blocking=False,
        )
        crew = MagicMock()
        crew.tasks = []
        crew.kickoff = MagicMock(return_value="ok")

        with patch("arcade_adapter.urlopen") as m:
            m.return_value = MagicMock()
            cb = wrap_crew(crew, options=opts)

        assert cb._emitter._session_id == "opts-session"
        assert cb._emitter._url == "http://opts-gateway:9999"
