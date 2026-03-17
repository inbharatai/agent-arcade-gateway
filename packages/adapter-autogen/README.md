# @agent-arcade/adapter-autogen

AutoGen adapter for Agent Arcade.

## Usage

```python
from agent_arcade_autogen import wrap_agents

adapter = wrap_agents(
    [assistant, user_proxy],
    gateway_url="http://localhost:47890",
    session_id="my-session",
)
user_proxy.initiate_chat(assistant, message="Write a hello world script")
adapter.disconnect()
```

## What Gets Tracked

| AutoGen Event | Arcade Event |
|---|---|
| Agent send message | `agent.message` |
| Generate reply | `agent.state(thinking)` |
| Reply generated | `agent.state(writing)` |
| Code execution | `agent.tool(code_executor)` |
| Function / tool call | `agent.tool` |
| Message link | `agent.link` |
| Conversation end | `agent.end` + `session.end` |

## Advanced Usage

```python
from agent_arcade_autogen import ArcadeAutoGenAdapter, ArcadeAutoGenOptions

options = ArcadeAutoGenOptions(
    gateway_url="http://localhost:47890",
    session_id="my-session",
    api_key="optional-token",
    track_tool_calls=True,
)
adapter = ArcadeAutoGenAdapter(options)
adapter.attach(assistant)
adapter.attach(user_proxy)

user_proxy.initiate_chat(assistant, message="Hello!")
adapter.disconnect()
```

## License

MIT
