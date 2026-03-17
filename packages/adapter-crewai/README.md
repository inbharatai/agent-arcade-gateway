# @agent-arcade/adapter-crewai

CrewAI adapter for Agent Arcade.

## Usage

```python
from agent_arcade_crewai import wrap_crew

crew = Crew(agents=[...], tasks=[...])
wrap_crew(crew, gateway_url="http://localhost:47890", session_id="my-session")
result = crew.kickoff()
```

## What Gets Tracked

| CrewAI Event | Arcade Event |
|---|---|
| Crew kickoff | `session.start` |
| Agent start | `agent.spawn` |
| Agent thinking | `agent.state(thinking)` |
| Tool usage | `agent.tool` |
| Task start | `agent.state(reading)` |
| Task complete | `agent.state(done)` |
| Delegation | `agent.link` |
| Crew complete | `session.end` |

## Advanced Usage

```python
from agent_arcade_crewai import ArcadeCrewAICallback, ArcadeCrewAIOptions

options = ArcadeCrewAIOptions(
    gateway_url="http://localhost:47890",
    session_id="my-session",
    api_key="optional-token",
    agent_name_prefix="Research",
    track_tokens=True,
)
cb = ArcadeCrewAICallback(options)

# Attach manually and control lifecycle
crew.step_callback = cb.on_step
crew.task_callback = cb.on_task_output
result = crew.kickoff()
cb.disconnect()
```

## License

MIT
