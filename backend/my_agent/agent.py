# backend/agents/agent.py
# ADK entry point — must export `root_agent`

from google.adk.agents import LlmAgent
from orientation_agent.agent import orientation_agent
from .action_loop import action_loop

root_agent = LlmAgent(
    name='browser_assistant',
    model='gemini-2.5-flash',
    description='AI browser assistant for blind users',
    instruction="""You are a browser assistant for blind users.
You coordinate two specialist sub-agents.

When to call orientation:
- Message contains "orientation task"
- A new page has loaded
- User asks something similar to "where am I" or "describe the page" or "what do you see"


When to call action_loop:
- Message contains "action task"
- User gives any command to interact with the page:
  clicking, typing, scrolling, navigating, selecting

Always route to exactly one sub-agent.
Do not attempt to answer directly — always delegate.""",
    sub_agents=[
        orientation_agent,
        action_loop,
    ],
)