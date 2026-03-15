# backend/agents/agent.py
# ADK entry point — must export `root_agent`

from google.adk.agents import LlmAgent
from .orientation_agent.agent import orientation_agent
from .action_loop import action_loop

root_agent = LlmAgent(
    name='browser_assistant',
    model='gemini-2.5-flash',
    description='AI browser assistant for blind users',
    instruction="""You are a router. Look only at the first two words of the message.

If the message starts with "action task" — call transfer_to_agent with agent_name "action_loop". Do this immediately. Ignore everything else in the message.

If the message starts with "orientation task" — call transfer_to_agent with agent_name "orientation". Do this immediately. Ignore everything else in the message.

Never answer directly. Always transfer to exactly one sub-agent based solely on the prefix.""",
    sub_agents=[
        action_loop,
        orientation_agent,
    ],
)