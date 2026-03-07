import json
import logging

from django.conf import settings as django_settings
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.models import User
from core.views.base import get_user_role, require_any_admin

from .models import Message
from .services.email_sender import get_email_sender, get_inbound_handler

logger = logging.getLogger(__name__)


# ===========================================================================
# PAGE VIEW — main mail UI
# ===========================================================================

@login_required
@require_any_admin
def mail_inbox(request):
    """Main mail page — defaults to inbox view."""
    user = request.user
    inbox_count = Message.objects.filter(
        recipient=user, recipient_trashed=False, is_read=False,
    ).count()
    context = {
        'active_page': 'adarsh_mail',
        'user_role': get_user_role(user),
        'inbox_unread': inbox_count,
    }
    return render(request, 'adarsh_mail/mail.html', context)


# ===========================================================================
# INTERNAL MAIL APIs — folder-based views for the 3-panel UI
# ===========================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_folder(request, folder):
    """Return messages for a given folder as JSON."""
    user = request.user

    if folder == 'inbox':
        qs = Message.objects.filter(recipient=user, recipient_trashed=False)
    elif folder == 'sent':
        qs = Message.objects.filter(sender=user, sender_trashed=False)
    elif folder == 'trash':
        qs = Message.objects.filter(
            Q(sender=user, sender_trashed=True) |
            Q(recipient=user, recipient_trashed=True)
        )
    else:
        return JsonResponse({'status': 'error', 'message': 'Invalid folder'}, status=400)

    messages_list = []
    for msg in qs.select_related('sender', 'recipient')[:100]:
        is_sender = msg.sender_id == user.id if msg.sender_id else False
        other = msg.recipient if is_sender else msg.sender
        other_name = (other.get_full_name() or other.username) if other else (msg.from_email or 'Unknown')
        sender_name = (msg.sender.get_full_name() or msg.sender.username) if msg.sender else msg.from_email
        recipient_name = (msg.recipient.get_full_name() or msg.recipient.username) if msg.recipient else msg.to_email
        messages_list.append({
            'id': msg.id,
            'uuid': str(msg.uuid),
            'sender_name': sender_name or 'Unknown',
            'recipient_name': recipient_name or 'Unknown',
            'other_name': other_name,
            'other_initial': other_name[0].upper() if other_name else '?',
            'from_email': msg.from_email,
            'to_email': msg.to_email,
            'subject': msg.subject,
            'preview': msg.body[:120],
            'is_read': msg.is_read,
            'is_sender': is_sender,
            'direction': msg.direction,
            'status': msg.status,
            'created_at': msg.created_at.strftime('%b %d, %Y %I:%M %p'),
            'created_at_short': msg.created_at.strftime('%b %d'),
        })

    logger.info('Inbox fetched — folder=%s count=%d user=%s', folder, len(messages_list), user.username)
    return JsonResponse({'status': 'ok', 'messages': messages_list})


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_counts(request):
    """Return unread / total counts per folder."""
    user = request.user
    inbox_unread = Message.objects.filter(
        recipient=user, recipient_trashed=False, is_read=False,
    ).count()
    inbox_total = Message.objects.filter(
        recipient=user, recipient_trashed=False,
    ).count()
    sent_total = Message.objects.filter(
        sender=user, sender_trashed=False,
    ).count()
    trash_total = Message.objects.filter(
        Q(sender=user, sender_trashed=True) |
        Q(recipient=user, recipient_trashed=True)
    ).count()
    return JsonResponse({
        'status': 'ok',
        'inbox_unread': inbox_unread,
        'inbox_total': inbox_total,
        'sent_total': sent_total,
        'trash_total': trash_total,
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_detail(request, message_id):
    """Return full message content. Marks as read if user is recipient."""
    user = request.user
    msg = get_object_or_404(
        Message.objects.select_related('sender', 'recipient'),
        Q(sender=user) | Q(recipient=user),
        id=message_id,
    )
    # Mark as read when recipient opens the message
    if msg.recipient_id == user.id and not msg.is_read:
        msg.is_read = True
        msg.save(update_fields=['is_read'])

    sender_name = (msg.sender.get_full_name() or msg.sender.username) if msg.sender else msg.from_email
    recipient_name = (msg.recipient.get_full_name() or msg.recipient.username) if msg.recipient else msg.to_email

    return JsonResponse({
        'status': 'ok',
        'message': {
            'id': msg.id,
            'uuid': str(msg.uuid),
            'sender_name': sender_name or 'Unknown',
            'sender_initial': (sender_name or '?')[0].upper(),
            'recipient_name': recipient_name or 'Unknown',
            'from_email': msg.from_email,
            'to_email': msg.to_email,
            'subject': msg.subject,
            'body': msg.body,
            'direction': msg.direction,
            'status': msg.status,
            'is_read': msg.is_read,
            'created_at': msg.created_at.strftime('%b %d, %Y %I:%M %p'),
        },
    })


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_compose(request):
    """Send a new internal mail message (user-to-user)."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    recipient_id = data.get('recipient_id')
    subject = (data.get('subject') or '').strip()
    body = (data.get('body') or '').strip()

    if not recipient_id:
        return JsonResponse({'status': 'error', 'message': 'Recipient is required'}, status=400)
    if not subject:
        return JsonResponse({'status': 'error', 'message': 'Subject is required'}, status=400)
    if not body:
        return JsonResponse({'status': 'error', 'message': 'Message body is required'}, status=400)

    try:
        recipient = User.objects.get(id=recipient_id, is_active=True)
    except User.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Recipient not found'}, status=404)

    if recipient.id == request.user.id:
        return JsonResponse({'status': 'error', 'message': 'Cannot send mail to yourself'}, status=400)

    sender = request.user
    default_from = getattr(django_settings, 'EMAIL_FROM', 'noreply@mydomain.com')
    from_email = f'{sender.get_full_name() or sender.username} <{default_from}>'

    Message.objects.create(
        sender=sender,
        recipient=recipient,
        from_email=from_email,
        to_email=recipient.email or '',
        subject=subject,
        body=body,
        direction='outgoing',
        status='sent',
    )
    logger.info('Email sent — from=%s to=%s subject="%s"', sender.username, recipient.username, subject)
    return JsonResponse({'status': 'ok', 'message': 'Message sent successfully'})


# ---------------------------------------------------------------------------
# Trash / Restore / Delete
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_trash(request, message_id):
    """Move a message to trash for the current user."""
    user = request.user
    msg = get_object_or_404(Message, Q(sender=user) | Q(recipient=user), id=message_id)

    if msg.sender_id == user.id:
        msg.sender_trashed = True
    if msg.recipient_id == user.id:
        msg.recipient_trashed = True
    msg.save(update_fields=['sender_trashed', 'recipient_trashed'])
    return JsonResponse({'status': 'ok', 'message': 'Moved to trash'})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_restore(request, message_id):
    """Restore a message from trash for the current user."""
    user = request.user
    msg = get_object_or_404(Message, Q(sender=user) | Q(recipient=user), id=message_id)

    if msg.sender_id == user.id:
        msg.sender_trashed = False
    if msg.recipient_id == user.id:
        msg.recipient_trashed = False
    msg.save(update_fields=['sender_trashed', 'recipient_trashed'])
    return JsonResponse({'status': 'ok', 'message': 'Message restored'})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_delete(request, message_id):
    """Permanently delete a trashed message (only if user has trashed it)."""
    user = request.user
    msg = get_object_or_404(Message, Q(sender=user) | Q(recipient=user), id=message_id)

    is_sender = msg.sender_id == user.id
    is_recipient = msg.recipient_id == user.id
    in_trash = (is_sender and msg.sender_trashed) or (is_recipient and msg.recipient_trashed)
    if not in_trash:
        return JsonResponse(
            {'status': 'error', 'message': 'Move to trash first'},
            status=400,
        )

    if msg.sender_trashed and msg.recipient_trashed:
        msg.delete()
    elif is_sender:
        msg.sender_trashed = True
        msg.save(update_fields=['sender_trashed'])
    else:
        msg.recipient_trashed = True
        msg.save(update_fields=['recipient_trashed'])

    return JsonResponse({'status': 'ok', 'message': 'Message deleted'})


# ---------------------------------------------------------------------------
# Recipients list (compose autocomplete)
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_recipients(request):
    """Return list of active users (excluding current user) for compose."""
    users = (
        User.objects
        .filter(is_active=True)
        .exclude(id=request.user.id)
        .order_by('first_name', 'last_name', 'username')
        .values('id', 'username', 'first_name', 'last_name', 'role')[:200]
    )
    recipients = []
    for u in users:
        full_name = f"{u['first_name']} {u['last_name']}".strip()
        display = full_name or u['username']
        recipients.append({
            'id': u['id'],
            'name': display,
            'username': u['username'],
            'role': u['role'],
        })
    return JsonResponse({'status': 'ok', 'recipients': recipients})


# ===========================================================================
# EMAIL INFRASTRUCTURE APIs — public-style endpoints for the email skeleton
# These complement the internal-mail panel APIs above.
# ===========================================================================

@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_email_send(request):
    """
    POST /api/email/send

    Send an email via the configured provider (currently mock).
    Body: { "to": "demo@gmail.com", "subject": "Hello", "body": "..." }

    Steps:
      1. Store email in database
      2. direction = "outgoing", status = "sent"
      3. timestamp = current time
      4. Delegate to email_sender service (mock logs it)

    FUTURE: Replace MockEmailSender with Brevo SMTP sender.
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    to_email = (data.get('to') or '').strip()
    subject = (data.get('subject') or '').strip()
    body = (data.get('body') or '').strip()

    if not to_email:
        return JsonResponse({'status': 'error', 'message': '"to" is required'}, status=400)
    if not subject:
        return JsonResponse({'status': 'error', 'message': '"subject" is required'}, status=400)
    if not body:
        return JsonResponse({'status': 'error', 'message': '"body" is required'}, status=400)

    from_address = getattr(django_settings, 'EMAIL_FROM', 'noreply@mydomain.com')

    sender_service = get_email_sender()
    msg = sender_service.send(
        from_email=from_address,
        to_email=to_email,
        subject=subject,
        body=body,
        sender_user=request.user,
    )
    logger.info('Email sent via API — id=%s to=%s', msg.id, to_email)

    return JsonResponse({
        'status': 'ok',
        'message': 'Email sent successfully',
        'email': {
            'id': str(msg.uuid),
            'from': msg.from_email,
            'to': msg.to_email,
            'subject': msg.subject,
            'direction': msg.direction,
            'status': msg.status,
            'timestamp': msg.created_at.isoformat(),
        },
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_email_inbox(request):
    """
    GET /api/email/inbox

    Return all emails sorted by timestamp DESC.
    Includes both incoming and outgoing for a full mail view.
    """
    qs = Message.objects.all().select_related('sender', 'recipient')[:100]
    emails = []
    for msg in qs:
        emails.append({
            'id': str(msg.uuid),
            'from': msg.from_email or (str(msg.sender) if msg.sender else 'Unknown'),
            'to': msg.to_email or (str(msg.recipient) if msg.recipient else 'Unknown'),
            'subject': msg.subject,
            'body': msg.body[:200],
            'timestamp': msg.created_at.isoformat(),
            'direction': msg.direction,
            'status': msg.status,
        })

    logger.info('Inbox fetched via email API — count=%d', len(emails))
    return JsonResponse({'status': 'ok', 'emails': emails})


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_email_detail(request, email_uuid):
    """
    GET /api/email/:id

    Return full email by UUID.
    """
    msg = get_object_or_404(Message.objects.select_related('sender', 'recipient'), uuid=email_uuid)

    return JsonResponse({
        'status': 'ok',
        'email': {
            'id': str(msg.uuid),
            'from': msg.from_email or (str(msg.sender) if msg.sender else 'Unknown'),
            'to': msg.to_email or (str(msg.recipient) if msg.recipient else 'Unknown'),
            'subject': msg.subject,
            'body': msg.body,
            'timestamp': msg.created_at.isoformat(),
            'direction': msg.direction,
            'status': msg.status,
        },
    })


@csrf_exempt
@require_http_methods(['POST'])
def api_inbound_webhook(request):
    """
    POST /api/email/inbound-webhook

    Simulates receiving an email from an external provider.
    Body: { "from": "john@example.com", "to": "support@mydomain.com",
            "subject": "Need help", "body": "Hello..." }

    Steps:
      1. Save email to database
      2. direction = "incoming", status = "received"
      3. timestamp = now

    FUTURE INTEGRATION
    ------------------
    * **Mailgun inbound webhook** — Mailgun POSTs multipart/form-data
      with fields: sender, recipient, subject, body-plain, body-html.
      Adapt the parsing below and add Mailgun signature verification.
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    from_email = (data.get('from') or '').strip()
    to_email = (data.get('to') or '').strip()
    subject = (data.get('subject') or '').strip()
    body = (data.get('body') or '').strip()

    if not from_email or not to_email:
        return JsonResponse(
            {'status': 'error', 'message': '"from" and "to" are required'},
            status=400,
        )

    handler = get_inbound_handler()
    msg = handler.receive(
        from_email=from_email,
        to_email=to_email,
        subject=subject or '(no subject)',
        body=body,
    )
    logger.info('Inbound email received — id=%s from=%s', msg.id, from_email)

    return JsonResponse({
        'status': 'ok',
        'message': 'Inbound email received',
        'email': {
            'id': str(msg.uuid),
            'from': msg.from_email,
            'to': msg.to_email,
            'subject': msg.subject,
            'direction': msg.direction,
            'status': msg.status,
            'timestamp': msg.created_at.isoformat(),
        },
    })


@csrf_exempt
@require_http_methods(['POST'])
def dev_simulate_incoming(request):
    """
    POST /dev/simulate-incoming-email

    Convenience endpoint for testing. Internally calls the inbound webhook
    handler to simulate receiving an external email.

    Body (optional — uses defaults if omitted):
    { "from": "test@example.com", "to": "support@mydomain.com",
      "subject": "Test Email", "body": "Simulated inbound message" }
    """
    if not getattr(django_settings, 'DEBUG', False):
        return JsonResponse(
            {'status': 'error', 'message': 'Only available in DEBUG mode'},
            status=403,
        )

    try:
        data = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, ValueError):
        data = {}

    from_email = data.get('from', 'simulator@example.com')
    to_email = data.get('to', getattr(django_settings, 'EMAIL_FROM', 'support@mydomain.com'))
    subject = data.get('subject', 'Simulated Incoming Email')
    body = data.get('body', 'This is a simulated inbound email for testing the webhook pipeline.')

    handler = get_inbound_handler()
    msg = handler.receive(
        from_email=from_email,
        to_email=to_email,
        subject=subject,
        body=body,
    )
    logger.info('Simulated inbound email created — id=%s', msg.id)

    return JsonResponse({
        'status': 'ok',
        'message': 'Simulated incoming email created',
        'email': {
            'id': str(msg.uuid),
            'from': msg.from_email,
            'to': msg.to_email,
            'subject': msg.subject,
            'direction': msg.direction,
            'status': msg.status,
            'timestamp': msg.created_at.isoformat(),
        },
    })
