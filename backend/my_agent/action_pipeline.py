# backend/agents/action_pipeline.py

from google.adk.agents import SequentialAgent
from actor_agent.agent import actor_agent
from grounder_agent.agent import grounder_agent
from verifier_agent.agent import verifier_agent
from orientation_agent.agent import orientation_agent

# Runs in strict order for every user command:
# 1. actor      — what does the user want to interact with?
# 2. grounder   — where exactly is that element on screen?
# 3. verifier   — did the action work? speak the result
# 4. orientation — describe the new page state to the user

action_pipeline = SequentialAgent(
    name='action_pipeline',
    description=(
        'Executes a single user command end to end: '
        'decides what to click, finds its coordinates, '
        'verifies the action worked, then re-orients the user'
    ),
    sub_agents=[
        actor_agent,
        grounder_agent,
        verifier_agent,
        orientation_agent,   # always runs last — user needs to know new state
    ],
)