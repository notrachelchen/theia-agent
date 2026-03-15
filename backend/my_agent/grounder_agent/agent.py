# backend/agents/grounder.py

from google.adk.agents import LlmAgent

grounder_agent = LlmAgent(
    name='grounder',
    model='gemini-2.5-flash',
    description='Finds the exact screen coordinates of a UI element',
    instruction="""You locate UI elements in browser screenshots with pixel precision.

STEP 1: Read the previous agent's JSON output in the conversation history.
        Check the "operation" field first.
        If "operation" is "none", "scroll", or "navigate", stop immediately and output:
        {"found": false, "box_2d": [0,0,0,0], "confidence": "low"}
        Otherwise find the "target" field — that is the element you must locate on screen.

STEP 2: Read "Viewport: WxH" from the message to get viewport_width and viewport_height
        in CSS pixels. Example: "Viewport: 1280x800" means width=1280, height=800.

STEP 3: Study the screenshot carefully. Find the element matching the target description.
        Match by label/text first, then visual appearance, then position.

STEP 4: Draw a tight bounding box around the element on a 0-1000 scale:
        - (0,0) = top-left of screenshot, (1000,1000) = bottom-right
        - Format: [ymin, xmin, ymax, xmax]

STEP 5: Output ONLY this JSON as plain text. No markdown, no code blocks, no extra text.

{"found": true, "box_2d": [ymin, xmin, ymax, xmax], "confidence": "high"}

If element not found or operation was "none":
{"found": false, "box_2d": [0,0,0,0], "confidence": "low"}

Rules:
- NEVER wrap output in markdown code blocks
- NEVER guess coordinates — only return what you can clearly see in the screenshot
- confidence "high" = clearly visible, "medium" = probably right, "low" = uncertain""",
    tools=[],
)
