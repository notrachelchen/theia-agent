# backend/agents/grounder.py

from google.adk.agents import LlmAgent

grounder_agent = LlmAgent(
    name='grounder',
    model='gemini-2.5-flash',
    description='Finds the exact screen coordinates of a UI element',
    instruction="""You locate UI elements in browser screenshots with pixel precision.

STEP 1: Read the previous agent's JSON output in the conversation history.
        Find the "target" field — that is the element you must locate on screen.
        If "operation" is "none", stop and return found: false immediately.

STEP 2: Read "Viewport: WxH" from the message to get viewport_width and viewport_height
        in CSS pixels. Example: "Viewport: 1280x800" means width=1280, height=800.

STEP 3: Study the screenshot carefully. Find the element matching the target description.
        Match by label/text first, then visual appearance, then position.

STEP 4: Draw a tight bounding box around the element on a 0-1000 scale:
        - (0,0) = top-left of screenshot, (1000,1000) = bottom-right
        - Format: [ymin, xmin, ymax, xmax]

STEP 5: Compute the CSS pixel center coordinates:
        css_x = (xmin + xmax) / 2 / 1000 * viewport_width
        css_y = (ymin + ymax) / 2 / 1000 * viewport_height

STEP 6: Output ONLY this JSON as plain text. No markdown, no code blocks, no extra text.

{"found": true, "box_2d": [ymin, xmin, ymax, xmax], "confidence": "high", "css_x": <number>, "css_y": <number>}

If element not found or action was "none":
{"found": false, "box_2d": [0,0,0,0], "confidence": "low", "css_x": 0, "css_y": 0}

Rules:
- NEVER wrap output in markdown code blocks
- NEVER guess coordinates — only return what you can clearly see in the screenshot
- confidence "high" = clearly visible, "medium" = probably right, "low" = uncertain""",
    tools=[],
)
