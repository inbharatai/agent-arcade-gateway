"""
Example: Python agent emitting telemetry to Agent Arcade

Run:
    python examples/python-agent.py

Requires:
    pip install python-socketio   (optional — falls back to HTTP)
"""

import time
import sys
import os

# Add the packages directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'packages', 'sdk-python'))
from agent_arcade import AgentArcade


def main():
    arcade = AgentArcade(url="http://localhost:8787", session_id="demo-session")

    # Spawn agents
    planner = arcade.spawn(name="Planner", role="manager")
    executor = arcade.spawn(name="Executor", role="engineer")

    # Planner workflow
    arcade.state(planner, "reading", label="Reading project requirements…")
    time.sleep(1)

    arcade.state(planner, "thinking", label="Creating execution plan…", progress=0.3)
    time.sleep(1.5)

    arcade.message(planner, "Plan: 1) Scaffold API  2) Add auth  3) Deploy")
    time.sleep(0.5)

    arcade.state(planner, "done", label="Plan ready", progress=1.0)

    # Executor workflow
    arcade.state(executor, "reading", label="Reading the plan…")
    time.sleep(0.8)

    arcade.link(executor, planner)  # executor reports to planner

    arcade.state(executor, "writing", label="Scaffolding API routes…", progress=0.2)
    time.sleep(1.5)

    arcade.tool(executor, "write_file", label="Writing routes/api.py")
    time.sleep(1)

    arcade.state(executor, "writing", label="Adding authentication…", progress=0.5)
    time.sleep(1.5)

    arcade.tool(executor, "run_command", label="Running tests…")
    time.sleep(1)

    arcade.message(executor, "All 12 tests passing ✓")
    time.sleep(0.5)

    arcade.state(executor, "done", label="Deployment ready", progress=1.0)

    # End
    arcade.end(planner, reason="All tasks planned and delegated", success=True)
    arcade.end(executor, reason="Implementation complete", success=True)

    time.sleep(1)
    arcade.disconnect()
    print("Done! Check Agent Arcade at http://localhost:3000")


if __name__ == "__main__":
    main()
