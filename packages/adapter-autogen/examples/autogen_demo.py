"""
AutoGen + Agent Arcade Demo

Shows how to visualize AutoGen multi-agent conversations in the Arcade dashboard.

Prerequisites:
    pip install pyautogen agent-arcade-autogen

Usage:
    python autogen_demo.py
"""

# from autogen import AssistantAgent, UserProxyAgent
# from agent_arcade_autogen import wrap_autogen_agents
#
# # Create AutoGen agents
# assistant = AssistantAgent(
#     "coder",
#     llm_config={"model": "gpt-4o"},
# )
#
# executor = UserProxyAgent(
#     "executor",
#     code_execution_config={"work_dir": "coding"},
# )
#
# reviewer = AssistantAgent(
#     "reviewer",
#     llm_config={"model": "gpt-4o"},
#     system_message="You review code for bugs and improvements.",
# )
#
# # One line to connect to Agent Arcade!
# hook = wrap_autogen_agents(
#     [assistant, executor, reviewer],
#     gateway_url="http://localhost:8787",
#     session_id="autogen-coding",
# )
#
# # Run the conversation -- all messages appear in the Arcade dashboard
# executor.initiate_chat(
#     assistant,
#     message="Write a Python script that calculates the Fibonacci sequence",
# )

print("AutoGen + Agent Arcade Demo")
print("Uncomment the code above to run with real AutoGen agents")
print("All agent conversations will appear at http://localhost:3000")
