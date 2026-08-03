"""Pro User session management API endpoints.

Allows Pro Users to revoke sessions for selected users or all users.
"""

import json
import logging

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from django.contrib.sessions.models import Session
from django.utils import timezone

from core.models import User
from accounts.services import AuthService
from core.services.permission_service import PermissionService
from core.models import ActivityLog

logger = logging.getLogger(__name__)


def _require_pro_user_or_super(request):
    user = getattr(request, 'user', None)
    if not (user and user.is_authenticated):
        return JsonResponse({'success': False, 'message': 'Authentication required.'}, status=403)
    # Allow Pro User and Super Admin to manage sessions.
    if PermissionService.is_pro_user(user) or PermissionService.is_super_admin(user):
        return None
    return JsonResponse({'success': False, 'message': 'Pro User or Super Admin access required.'}, status=403)


def _parse_json_body(request):
    if not getattr(request, 'body', b''):
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


@login_required
@require_http_methods(['POST'])
def api_pro_user_revoke_sessions(request):
    """Revoke sessions for given user ids or all sessions.

    JSON body options:
      - {"user_ids": [1,2,3]}    => revoke sessions for these users
      - {"all": true}            => revoke all sessions (preserves current pro_user session)
      - {"preserve_self": false} => when revoking all, allow revoking current session too
    """
    guard = _require_pro_user_or_super(request)
    if guard is not None:
        return guard

    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    preserve_self = True if body.get('preserve_self', True) else False
    user_ids = body.get('user_ids') or []
    do_all = bool(body.get('all'))

    revoked_count = 0
    revoked_tails = []
    audit_entries = []

    try:
        if do_all:
            # Revoke all DB sessions, optionally preserving the caller's session
            my_key = request.session.session_key if preserve_self else None
            qs = Session.objects.filter(expire_date__gt=timezone.now())
            for sess in qs.iterator(chunk_size=200):
                try:
                    if my_key and sess.session_key == my_key:
                        continue
                    sess.delete()
                    revoked_count += 1
                    revoked_tails.append(sess.session_key[-8:] if sess.session_key else '')
                except Exception:
                    continue

        else:
            # Revoke sessions for explicit user ids
            for uid in list(user_ids or []):
                try:
                    user_obj = User.objects.filter(id=uid).first()
                    if not user_obj:
                        continue
                    res = AuthService.revoke_active_sessions_for_user(user_obj.id)
                    revoked_count += int(res.get('revoked_count', 0) or 0)
                    for s in (res.get('revoked_sessions') or []):
                        tail = str(s.get('session_tail') or '')
                        revoked_tails.append(tail)
                    # Track for audit logging
                    audit_entries.append(uid)
                except Exception:
                    logger.exception('Failed revoking sessions for user_id=%s', uid)
                    continue
        
        # Audit log (moved outside exception handler to always execute on success)
        try:
            actor = request.user if request.user and request.user.is_authenticated else None
            ip = (request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '').split(',')[0].strip()
            
            if do_all:
                ActivityLog.objects.create(
                    user=actor,
                    action='other',
                    description=f'Revoked all active sessions (preserve_self={preserve_self}, count={revoked_count})',
                    target_model='Session',
                    target_id=None,
                    target_name='all_sessions',
                    ip_address=ip or None,
                )
            else:
                # Create separate audit entry for each user's session revocation
                for uid in audit_entries:
                    ActivityLog.objects.create(
                        user=actor,
                        action='other',
                        description=f'Revoked all sessions for user_id={uid}',
                        target_model='core.User',
                        target_id=int(uid) if uid else None,
                        target_name=str(uid),
                        ip_address=ip or None,
                    )
        except Exception as e:
            logger.exception('Failed creating activity log for revoke request: %s', e)
            
    except Exception as exc:
        logger.exception('Failed processing revoke request: %s', exc)
        return JsonResponse({'success': False, 'message': 'Internal error'}, status=500)

    return JsonResponse({
        'success': True,
        'revoked_count': int(revoked_count or 0),
        'revoked_tails': revoked_tails,
    })


@login_required
@require_http_methods(['GET'])
def api_pro_user_list_sessions(request):
    """List active sessions for a given user id.
    Query params: ?user_id=123
    """
    guard = _require_pro_user_or_super(request)
    if guard is not None:
        return guard

    try:
        user_id = int(request.GET.get('user_id') or 0)
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'message': 'user_id required'}, status=400)

    sessions = AuthService.list_active_sessions_for_user(user_id, limit=200)
    return JsonResponse({'success': True, 'sessions': sessions})


@login_required
@require_http_methods(['POST'])
def api_pro_user_revoke_session_key(request):
    """Revoke a single session by session_key.
    
    JSON body: {
        "session_key": "abcd...",    # Full session key (required)
        "user_id": 123               # Optional: for audit tracking
    }
    
    Uses exact session_key match (not endswith) to avoid ambiguity.
    """
    guard = _require_pro_user_or_super(request)
    if guard is not None:
        return guard

    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    session_key = body.get('session_key')
    user_id = body.get('user_id')
    
    if not session_key or not isinstance(session_key, str):
        return JsonResponse({'success': False, 'message': 'session_key (string) required'}, status=400)
    
    # Validate session_key format (should be ~32 char hex string)
    if len(session_key) < 20 or len(session_key) > 50:
        return JsonResponse({'success': False, 'message': 'Invalid session_key format'}, status=400)

    try:
        sess = Session.objects.filter(session_key=session_key).first()
        if not sess:
            return JsonResponse({'success': False, 'message': 'Session not found'}, status=404)
        
        # Decode session to get user info for audit
        session_data = sess.get_decoded()
        session_user_id = session_data.get('_auth_user_id')
        
        # Delete the session
        sess.delete()
        
        # Audit log
        try:
            actor = request.user if request.user and request.user.is_authenticated else None
            ip = (request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '').split(',')[0].strip()
            
            ActivityLog.objects.create(
                user=actor,
                action='other',
                description=f'Revoked session for user_id={session_user_id or user_id or "unknown"} (session_key_tail={session_key[-8:]})',
                target_model='Session',
                target_id=None,
                target_name=session_key[-8:],
                ip_address=ip or None,
            )
        except Exception as e:
            logger.exception('Failed creating activity log for session revoke: %s', e)
        
        return JsonResponse({'success': True, 'message': 'Session revoked'})
    except Exception as exc:
        logger.exception('Failed revoking session %s: %s', session_key, exc)
        return JsonResponse({'success': False, 'message': 'Internal error'}, status=500)
