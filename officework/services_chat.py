"""Office Work chat and group domain service.

Encapsulates group visibility, membership updates, message creation, and
realtime fanout so HTTP and websocket paths share one source of truth.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.urls import reverse
from django.utils import timezone

from core.services.permission_service import PermissionService
from core.services.realtime_service import publish_topic_event
from officework.upload_security import is_blocked_upload_name

from .models import OfficeWorkChatGroup, OfficeWorkChatGroupMember, OfficeWorkChatMessage

MAX_CHAT_MESSAGE_LENGTH = 4000
MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024
OFFICEWORK_PRESENCE_ONLINE_WINDOW_SECONDS = 75
OFFICEWORK_PRESENCE_RETENTION_SECONDS = 60 * 60 * 24 * 14


def officework_allowed_members_qs():
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return (
        User.objects.filter(role__in=('pro_user', 'super_admin', 'admin_staff'), is_active=True)
        .only('id', 'first_name', 'last_name', 'username', 'email', 'role')
        .order_by('first_name', 'username', 'id')
    )


def officework_group_topic(group_id: int) -> str:
    return f'officework.chat.group.{int(group_id)}'


def officework_user_topic(user_id: int) -> str:
    return f'officework.chat.user.{int(user_id)}'


def _officework_presence_key(user_id: int) -> str:
    return f'officework:presence:last_seen:{int(user_id)}'


def mark_officework_user_presence(user):
    user_id = int(getattr(user, 'id', 0) or 0)
    if user_id <= 0:
        return None
    now = timezone.now()
    cache.set(_officework_presence_key(user_id), now.isoformat(), timeout=OFFICEWORK_PRESENCE_RETENTION_SECONDS)
    return now


def _parse_presence_value(raw_value):
    if raw_value is None:
        return None

    dt = raw_value if isinstance(raw_value, datetime) else None
    if dt is None:
        text = str(raw_value or '').strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None

    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _presence_map_for_users(user_ids: Iterable[int]) -> dict[int, datetime]:
    normalized_ids = set()
    for raw_user_id in (user_ids or []):
        try:
            parsed_id = int(raw_user_id)
        except (TypeError, ValueError):
            continue
        if parsed_id > 0:
            normalized_ids.add(parsed_id)
    if not normalized_ids:
        return {}

    key_by_user_id = {
        user_id: _officework_presence_key(user_id)
        for user_id in normalized_ids
    }
    raw_map = cache.get_many(list(key_by_user_id.values()))

    result = {}
    for user_id, cache_key in key_by_user_id.items():
        parsed = _parse_presence_value(raw_map.get(cache_key))
        if parsed is not None:
            result[user_id] = parsed
    return result


def _serialize_member(user, *, presence_map=None, now=None) -> dict:
    user_id = int(getattr(user, 'id', 0) or 0)
    current_time = now or timezone.now()
    latest_seen = None

    if isinstance(presence_map, dict):
        latest_seen = presence_map.get(user_id)
    if latest_seen is None and getattr(user, 'last_login', None):
        latest_seen = user.last_login
        if timezone.is_naive(latest_seen):
            latest_seen = timezone.make_aware(latest_seen, timezone.get_current_timezone())

    is_online = bool(
        latest_seen is not None
        and (current_time - latest_seen).total_seconds() <= OFFICEWORK_PRESENCE_ONLINE_WINDOW_SECONDS
    )

    full_name = (user.get_full_name() or '').strip()
    return {
        'id': user_id,
        'name': full_name or user.username or user.email or f'User {user_id}',
        'role': user.role,
        'role_display': user.get_role_display() if hasattr(user, 'get_role_display') else user.role,
        'is_online': is_online,
        'last_seen_at': latest_seen.isoformat() if latest_seen else None,
    }


def _serialize_attachment(message: OfficeWorkChatMessage) -> dict | None:
    if not message.attachment:
        return None

    return {
        'name': message.attachment_original_name or message.attachment.name.rsplit('/', 1)[-1],
        'size_bytes': int(message.attachment_size_bytes or 0),
        'content_type': message.attachment_content_type or '',
        'download_url': reverse('api_office_work_chat_attachment_download', args=[message.id]),
    }


def serialize_office_work_chat_message(message: OfficeWorkChatMessage) -> dict:
    sender = message.sender
    sender_name = 'Unknown User'
    sender_role = ''
    sender_id = None
    if sender is not None:
        sender_id = sender.id
        sender_role = getattr(sender, 'role', '') or ''
        sender_name = (sender.get_full_name() or '').strip() or sender.username or sender.email or f'User {sender.id}'

    return {
        'id': message.id,
        'group_id': message.group_id,
        'group_name': message.group.name if message.group_id else '',
        'message': message.message,
        'sender_id': sender_id,
        'sender_name': sender_name,
        'sender_role': sender_role,
        'attachment': _serialize_attachment(message),
        'created_at': message.created_at.isoformat(),
    }


def serialize_office_work_chat_group(group: OfficeWorkChatGroup) -> dict:
    return {
        'id': group.id,
        'name': group.name,
        'is_active': bool(group.is_active),
        'created_by_id': group.created_by_id,
        'created_at': group.created_at.isoformat() if group.created_at else None,
        'member_count': int(getattr(group, 'member_count', 0) or 0),
    }


def user_can_access_officework_chat(user) -> bool:
    return PermissionService.is_any_admin(user)


def user_can_manage_officework_groups(user) -> bool:
    return PermissionService.is_any_admin(user)


def user_visible_groups_qs(user):
    return (
        OfficeWorkChatGroup.objects.filter(is_active=True, memberships__user=user)
        .select_related('created_by')
        .prefetch_related('memberships__user')
        .distinct()
        .order_by('name', 'id')
    )


def _emit_groups_refresh(user_ids: Iterable[int]):
    unique_ids = {int(uid) for uid in user_ids if int(uid) > 0}
    for user_id in unique_ids:
        publish_topic_event(
            topic=officework_user_topic(user_id),
            event_type='officework.chat.groups.refresh',
            payload={'user_id': user_id},
        )


@transaction.atomic
def create_officework_chat_group(*, actor, name: str, member_ids: Iterable[int]) -> OfficeWorkChatGroup:
    if not user_can_manage_officework_groups(actor):
        raise PermissionDenied('Not allowed to create Office Work groups.')

    clean_name = str(name or '').strip()
    if not clean_name:
        raise ValueError('Group name is required.')

    group = OfficeWorkChatGroup.objects.create(
        name=clean_name[:120],
        created_by=actor,
        is_active=True,
    )

    allowed_users = officework_allowed_members_qs()
    wanted_ids = {int(actor.id)}
    for raw_id in member_ids or []:
        try:
            wanted_ids.add(int(raw_id))
        except (TypeError, ValueError):
            continue

    users = list(allowed_users.filter(id__in=wanted_ids))
    OfficeWorkChatGroupMember.objects.bulk_create(
        [
            OfficeWorkChatGroupMember(group=group, user=user, added_by=actor)
            for user in users
        ],
        ignore_conflicts=True,
    )

    _emit_groups_refresh([user.id for user in users])
    return group


@transaction.atomic
def replace_officework_chat_group_members(*, actor, group: OfficeWorkChatGroup, member_ids: Iterable[int]) -> OfficeWorkChatGroup:
    if not user_can_manage_officework_groups(actor):
        raise PermissionDenied('Not allowed to update Office Work groups.')

    allowed_users = officework_allowed_members_qs()
    wanted_ids = {int(actor.id)}
    for raw_id in member_ids or []:
        try:
            wanted_ids.add(int(raw_id))
        except (TypeError, ValueError):
            continue

    users = list(allowed_users.filter(id__in=wanted_ids))
    new_user_ids = {user.id for user in users}
    previous_user_ids = set(group.memberships.values_list('user_id', flat=True))

    group.memberships.exclude(user_id__in=new_user_ids).delete()
    OfficeWorkChatGroupMember.objects.bulk_create(
        [
            OfficeWorkChatGroupMember(group=group, user=user, added_by=actor)
            for user in users
        ],
        ignore_conflicts=True,
    )

    _emit_groups_refresh(previous_user_ids | new_user_ids)
    return group


def resolve_group_for_user(*, user, group_id: int | None):
    visible_groups = user_visible_groups_qs(user)
    if group_id:
        group = visible_groups.filter(id=int(group_id)).first()
        if group is None:
            raise PermissionDenied('You do not have access to this group.')
        return group
    return visible_groups.first()


def user_can_access_group(user, group_id: int) -> bool:
    if not getattr(user, 'is_authenticated', False):
        return False
    if not user_can_access_officework_chat(user):
        return False
    return OfficeWorkChatGroupMember.objects.filter(group_id=group_id, user=user, group__is_active=True).exists()


def create_office_work_chat_message(*, sender, message_text: str, group=None, attachment=None) -> dict:
    if not PermissionService.is_any_admin(sender):
        raise PermissionDenied('You are not allowed to send office chat messages.')

    text = str(message_text or '').strip()
    if len(text) > MAX_CHAT_MESSAGE_LENGTH:
        text = text[:MAX_CHAT_MESSAGE_LENGTH]

    if group is None:
        group = resolve_group_for_user(user=sender, group_id=None)

    if group is None:
        raise ValueError('No chat group available.')

    if not user_can_access_group(sender, group.id):
        raise PermissionDenied('You do not have access to this group.')

    upload = attachment
    attachment_name = ''
    attachment_size = 0
    attachment_content_type = ''

    if upload is not None:
        attachment_size = int(getattr(upload, 'size', 0) or 0)
        if attachment_size <= 0:
            raise ValueError('Attachment file is empty.')
        if attachment_size > MAX_CHAT_ATTACHMENT_BYTES:
            raise ValueError('Attachment is too large (max 50 MB).')
        if is_blocked_upload_name(getattr(upload, 'name', '')):
            raise ValueError('This file type is not allowed for security reasons.')
        attachment_name = (getattr(upload, 'name', '') or '')[:255]
        attachment_content_type = str(getattr(upload, 'content_type', '') or '')[:160]

    if not text and upload is None:
        raise ValueError('Message or attachment is required.')

    message = OfficeWorkChatMessage.objects.create(
        group=group,
        sender=sender,
        message=text,
        attachment=upload,
        attachment_original_name=attachment_name,
        attachment_size_bytes=attachment_size,
        attachment_content_type=attachment_content_type,
    )
    message = OfficeWorkChatMessage.objects.select_related('sender', 'group').get(pk=message.pk)
    payload = serialize_office_work_chat_message(message)

    publish_topic_event(
        topic=officework_group_topic(group.id),
        event_type='officework.chat.message',
        payload={'item': payload},
    )

    member_user_ids = list(
        OfficeWorkChatGroupMember.objects.filter(group=group).values_list('user_id', flat=True)
    )
    for member_user_id in member_user_ids:
        publish_topic_event(
            topic=officework_user_topic(member_user_id),
            event_type='officework.chat.message',
            payload={'item': payload},
        )

    return payload


def list_visible_groups_payload(user) -> dict:
    groups = list(user_visible_groups_qs(user))
    available_members = list(officework_allowed_members_qs())

    # Legacy cleanup behavior: hide empty auto-seeded "General" groups.
    filtered_groups = []
    for group in groups:
        if str(group.name or '').strip().lower() == 'general':
            has_messages = OfficeWorkChatMessage.objects.filter(group_id=group.id).exists()
            if not has_messages:
                continue
        filtered_groups.append(group)
    groups = filtered_groups

    group_ids = [group.id for group in groups]
    all_member_ids = {int(user.id or 0)}
    all_member_ids.update(int(member.id or 0) for member in available_members)

    member_map = {gid: [] for gid in group_ids}
    memberships = (
        OfficeWorkChatGroupMember.objects.filter(group_id__in=group_ids)
        .select_related('user')
        .order_by('id')
    )
    for membership in memberships:
        all_member_ids.add(int(getattr(membership, 'user_id', 0) or 0))

    presence_map = _presence_map_for_users(all_member_ids)
    now = timezone.now()

    for membership in memberships:
        member_map.setdefault(membership.group_id, []).append(_serialize_member(membership.user, presence_map=presence_map, now=now))

    group_payload = []
    for group in groups:
        item = serialize_office_work_chat_group(group)
        item['members'] = member_map.get(group.id, [])
        group_payload.append(item)

    return {
        'groups': group_payload,
        'available_members': [_serialize_member(member, presence_map=presence_map, now=now) for member in available_members],
        'can_manage_groups': user_can_manage_officework_groups(user),
    }
