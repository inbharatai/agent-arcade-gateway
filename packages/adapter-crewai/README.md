# agent-arcade-crewai

CrewAI adapter for Agent Arcade. Auto-instruments crews, agents, tasks, and delegations.

## Quick Start

```python
from crewai import Agent, Task, Crew
from agent_arcade_crewai import arcade_crew

crew = Crew(agents=[...], tasks=[...])
wrapped = arcade_crew(crew, gateway_url="http://localhost:8787", session_id="my-crew")
result = wrapped.kickoff()
```

## What Gets Tracked

| CrewAI Event | Arcade Event |
|-------------|-------------|
| Crew kickoff | session.start |
| Agent start | agent.spawn |
| Agent thinking | agent.state(thinking) |
| Tool usage | agent.tool |
| Task start | agent.state(reading) |
| Task complete | agent.state(done) |
| Delegation | agent.link |
| Crew complete | session.end |

## License

MIT
