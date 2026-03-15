# backend/agents/action_pipeline.py

from google.adk.agents import SequentialAgent
from .actor_agent.agent import actor_agent
from .grounder_agent.agent import grounder_agent
from .verifier_agent.agent import verifier_agent

# Runs in strict order for every user command:
# 1. actor    — what does the user want to interact with?
# 2. grounder — where exactly is that element on screen?
# 3. verifier — did the action work?
# Post-action orientation is handled by the extension after the click executes.

action_pipeline = SequentialAgent(
    name='action_pipeline',
    description=(
        'Executes a single user command end to end: '
        'decides what to click, finds its coordinates, '
        'and verifies the action worked'
    ),
    sub_agents=[
        actor_agent,
        grounder_agent,
        verifier_agent,
    ],
)