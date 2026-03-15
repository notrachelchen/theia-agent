# backend/agents/tools.py
# All tools used across agents — imported individually by each agent

from google.adk.tools import FunctionTool

# In-memory action history — shared across all agents in a session
_action_history = []


# ── PAGE METADATA ────────────────────────────────────────────────────────────

def get_page_metadata(url: str, title: str, scroll_y: int, vw: int, vh: int) -> dict:
    """
    Returns structured page context for the orientation agent.
    Gives it facts it cannot reliably infer from pixels alone —
    scroll position, page type, domain.
    """
    url = str(url or '')
    title = str(title or '')
    scroll_y = int(scroll_y) if scroll_y is not None else 0
    vw = int(vw) if vw is not None else 1920
    vh = int(vh) if vh is not None else 1080

    scroll_percent = round((scroll_y / vh) * 100) if vh > 0 else 0

    # Clean domain from URL
    domain = ''
    if url:
        parts = url.replace('https://', '').replace('http://', '').split('/')
        domain = (parts[0] or '').replace('www.', '')

    # Infer page type from URL path
    path = ''
    if domain and domain in url:
        try:
            path = url.split(domain)[-1] if domain else ''
        except (ValueError, TypeError):
            pass
    if path in ('', '/'):
        page_type = 'homepage'
    elif any(x in path for x in ['product', 'item', '/p/', '/dp/']):
        page_type = 'product page'
    elif any(x in path for x in ['cart', 'basket', 'bag']):
        page_type = 'cart page'
    elif 'checkout' in path:
        page_type = 'checkout page'
    elif any(x in path for x in ['search', 'results', 'query']):
        page_type = 'search results'
    elif any(x in path for x in ['account', 'profile', 'settings']):
        page_type = 'account page'
    elif any(x in path for x in ['login', 'signin', 'sign-in']):
        page_type = 'login page'
    elif any(x in path for x in ['order', 'confirmation', 'thank']):
        page_type = 'order confirmation'
    else:
        page_type = 'page'

    return {
        'domain':         domain,
        'page_type':      page_type,
        'full_url':       url,
        'page_title':     title,
        'scroll_y':       scroll_y,
        'scroll_percent': scroll_percent,
        'is_scrolled':    scroll_y > 100,
        'at_top':         scroll_y < 50,
        'at_bottom':      scroll_percent > 90,
    }


# ── ACTION HISTORY ───────────────────────────────────────────────────────────

def get_action_history() -> dict:
    """
    Returns the last 5 actions taken.
    Actor uses this to avoid retrying something that already failed.
    """
    return {
        'history':       _action_history[-5:],
        'total_actions': len(_action_history),
    }


def save_action_result(
    action: str,
    target: str,
    success: bool,
    narration: str
) -> dict:
    """
    Saves a completed action to history.
    Verifier calls this after confirming whether the action worked.
    """
    entry = {
        'action':    action,
        'target':    target,
        'success':   success,
        'narration': narration,
    }
    _action_history.append(entry)
    return {'saved': True, 'history_length': len(_action_history)}


def clear_action_history() -> dict:
    """Clears history — called when a new page loads."""
    _action_history.clear()
    return {'cleared': True}


# ── VIEWPORT ─────────────────────────────────────────────────────────────────

def get_viewport_info(vw: int, vh: int, dpr: float) -> dict:
    """
    Returns viewport dimensions.
    Grounder calls this before computing CSS coordinates
    to confirm the coordinate space.
    """
    return {
        'viewport_width':    vw,
        'viewport_height':   vh,
        'device_pixel_ratio': dpr,
        'physical_width':    int(vw * dpr),
        'physical_height':   int(vh * dpr),
    }


# ── COMMAND CLARIFICATION ─────────────────────────────────────────────────────

def clarify_command(command: str, visible_elements: list[str]) -> dict:
    """
    Actor calls this when a user command is ambiguous
    and multiple elements could match.
    Returns a question to speak to the user.
    """
    if not visible_elements:
        return {'needs_clarification': False}

    if len(visible_elements) == 1:
        return {
            'needs_clarification': False,
            'resolved_to': visible_elements[0],
        }

    options = ', '.join(visible_elements[:3])
    return {
        'needs_clarification': True,
        'question': f'I can see multiple options: {options}. Which one did you mean?',
    }


# ── WRAP AS ADK FUNCTION TOOLS ───────────────────────────────────────────────

page_metadata_tool    = FunctionTool(func=get_page_metadata)
action_history_tool   = FunctionTool(func=get_action_history)
save_result_tool      = FunctionTool(func=save_action_result)
clear_history_tool    = FunctionTool(func=clear_action_history)
viewport_tool         = FunctionTool(func=get_viewport_info)
clarify_tool          = FunctionTool(func=clarify_command)