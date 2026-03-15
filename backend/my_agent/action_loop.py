# backend/agents/action_loop.py

from google.adk.agents import LoopAgent
from .action_pipeline import action_pipeline

# Wraps the action pipeline in a retry loop.
# If the verifier says the action failed, the whole pipeline
# reruns with a fresh screenshot — up to 3 times.
# Orientation still runs after every successful attempt.

action_loop = LoopAgent(
    name='action_loop',
    description=(
        'Executes a user command and retries up to 3 times '
        'if the action fails. Re-orients the user after each attempt.'
    ),
    sub_agents=[action_pipeline],
    max_iterations=3,
)