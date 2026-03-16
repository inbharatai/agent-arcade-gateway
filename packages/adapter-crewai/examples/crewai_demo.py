"""
CrewAI + Agent Arcade Demo

Shows how to visualize CrewAI crews in the Arcade dashboard.

Prerequisites:
    pip install crewai agent-arcade-crewai

Usage:
    python crewai_demo.py
"""

# from crewai import Agent, Task, Crew
# from agent_arcade_crewai import arcade_crew
#
# # Define agents
# researcher = Agent(
#     role="AI Researcher",
#     goal="Find the latest AI developments",
#     backstory="You are an expert AI researcher",
# )
#
# writer = Agent(
#     role="Technical Writer",
#     goal="Write clear technical content",
#     backstory="You are an experienced technical writer",
# )
#
# # Define tasks
# research_task = Task(
#     description="Research the latest advances in AI agents",
#     agent=researcher,
# )
#
# writing_task = Task(
#     description="Write a blog post about AI agents based on the research",
#     agent=writer,
# )
#
# # Create and wrap the crew
# crew = Crew(
#     agents=[researcher, writer],
#     tasks=[research_task, writing_task],
# )
#
# # One line to connect to Agent Arcade!
# wrapped = arcade_crew(
#     crew,
#     gateway_url="http://localhost:47890",
#     session_id="crewai-research",
# )
#
# # Run -- all agent activity appears in the Arcade dashboard
# result = wrapped.kickoff()
# print(result)

print("CrewAI + Agent Arcade Demo")
print("Uncomment the code above to run with a real CrewAI crew")
print("All agent activity will appear at http://localhost:47380")
