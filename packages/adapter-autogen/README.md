# agent-arcade-autogen

AutoGen adapter for Agent Arcade. Auto-instruments multi-agent conversations for real-time visualization.

## Quick Start

```python
from autogen import AssistantAgent, UserProxyAgent
from agent_arcade_autogen import wrap_autogen_agents

assistant = AssistantAgent("coder", llm_config={...})
user_proxy = UserProxyAgent("executor")

wrap_autogen_agents(
    [assistant, user_proxy],
    gateway_url="http://localhost:8787",
    session_id="my-autogen-chat",
)

user_proxy.initiate_chat(assistant, message="Write hello world")
```

## What Gets Tracked

| AutoGen Event | Arcade Event |
|-------------|-------------|
| Agent send message | agent.message |
| Generate reply | agent.state(thinking) |
| Reply generated | agent.state(writing) |
| Code execution | agent.tool(code_executor) |
| Function call | agent.tool |
| Conversation end | agent.end |

## License

MIT
