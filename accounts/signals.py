from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver
from .services import AuthService

@receiver(user_logged_in)
def enforce_single_session(sender, request, user, **kwargs):
    """
    Enforce only ONE active session per user.
    When a user logs in, revoke all their other active sessions.
    """
    if not user or not user.id:
        return

    # Use the existing AuthService to revoke other sessions.
    # exclude_session_key ensures the CURRENT session (the one just created/rotated) stays alive.
    AuthService.revoke_active_sessions_for_user(
        user_id=user.id,
        exclude_session_key=request.session.session_key
    )
