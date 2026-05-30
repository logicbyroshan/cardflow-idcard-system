"""
Client Staff Service — CRUD operations for client-managed staff members.
"""
from typing import Dict, Any, Optional, List, Tuple
import logging
import os
import secrets

from django.db import transaction
from django.db.models import Prefetch
from django.utils.timezone import localtime

from core.models import User, EmailLog
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.cache_version_service import CacheVersionService
from core.services.permission_service import PermissionService
from core.utils import send_welcome_email

from .services_access import ClientAccessService

logger = logging.getLogger(__name__)


class ClientStaffService(BaseService):
    """
    Service for client staff management.
    Only Client Admin (role='client') can manage staff.
    """
    
    # All permission fields that clients can delegate to their staff.
    # Must match the Client model fields AND exist on the Staff model.
    # Groups: ID Card List Tabs | Card Actions | Bulk Actions | App
    STAFF_PERMISSION_FIELDS = [
        # ── ID Card List Tabs ────────────────────────────────────────
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list',
        # ── Export / Download ───────────────────────────────────────
        'perm_idcard_bulk_download',
        # ── Card Actions ──────────────────────────────────────────────
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_verify',
        'perm_idcard_updated_at',
        'perm_idcard_retrieve',
        # ── App & Access ───────────────────────────────────────────
        'perm_mobile_app',
    ]

    # Sensitive permissions that client_staff must never hold.
    NON_DELEGABLE_CLIENT_STAFF_PERMS = [
        'perm_idcard_approve',
        'perm_idcard_delete_from_pool',
        'perm_idcard_download_image_rename_mode',
        'perm_idcard_download_image_generate_mode',
    ]

    @staticmethod
    def _public_email(email: str) -> str:
        """Hide internal placeholder emails from API payloads."""
        value = (email or '').strip()
        return '' if value.endswith('@noemail.local') else value

    @staticmethod
    def _has_real_email(email: str) -> bool:
        """Return True when the address is suitable for SMTP delivery."""
        value = (email or '').strip().lower()
        return bool(value and '@' in value and not value.endswith('@noemail.local'))

    @staticmethod
    def _unexpected_error_result(action: str, exc: Exception) -> ServiceResult:
        logger.exception('ClientStaffService.%s failed: %s', action, exc)
        return ServiceResult(success=False, message='An unexpected error occurred. Please try again.')

    @staticmethod
    def _bump_dashboard_cache_versions(client_id: int) -> None:
        try:
            cid = int(client_id)
        except (TypeError, ValueError):
            return
        CacheVersionService.bump('dash_team_overview', 'global')
        CacheVersionService.bump('client_staff', f'client:{cid}')

    @staticmethod
    def _resolve_assignment_scope_ids(
        client: Client,
        raw_ids: Any,
        id_source: str = 'auto',
    ) -> Tuple[List[int], List[int]]:
        """Normalize assignment IDs into valid group IDs and table IDs.

        ``id_source`` controls interpretation of ``raw_ids``:
        - ``group``: IDs are group IDs
        - ``table``: IDs are table IDs
        - ``auto``: follows client assignment mode (single group => table mode)
        """
        if not isinstance(raw_ids, list):
            return [], []

        normalized_ids = sorted({
            int(v) for v in raw_ids
            if not isinstance(v, bool) and str(v).strip().isdigit() and int(v) > 0
        })
        if not normalized_ids:
            return [], []

        source = str(id_source or '').strip().lower()
        if source not in ('group', 'table', 'auto'):
            source = 'auto'

        if source == 'auto':
            group_count = IDCardGroup.objects.filter(client=client).count()
            source = 'table' if group_count <= 1 else 'group'

        valid_group_ids = set(
            IDCardGroup.objects.filter(client=client, id__in=normalized_ids)
            .values_list('id', flat=True)
        )

        if source == 'group':
            return sorted(valid_group_ids), []

        valid_table_ids = set(
            IDCardTable.objects.filter(
                group__client=client,
                deleted_by_client=False,
                id__in=normalized_ids,
            ).values_list('id', flat=True)
        )

        if valid_table_ids:
            table_group_ids = IDCardTable.objects.filter(
                id__in=valid_table_ids,
            ).values_list('group_id', flat=True)
            valid_group_ids.update(table_group_ids)
            return sorted(valid_group_ids), sorted(valid_table_ids)

        # Backward-compatible fallback: keep group assignments even when
        # table mode was inferred but table IDs are not present in payload.
        return sorted(valid_group_ids), []

    @staticmethod
    def _normalize_scope_value_list(raw_values: Any) -> List[str]:
        """Normalize class/section/branch lists into unique non-empty strings."""
        if not isinstance(raw_values, list):
            return []

        out: List[str] = []
        seen = set()
        for value in raw_values:
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            out.append(text)
        return out

    @staticmethod
    def _normalize_class_section_map(raw_map: Any) -> Dict[str, List[str]]:
        """Normalize per-class section selections into a string-to-list map."""
        if not isinstance(raw_map, dict):
            return {}

        out: Dict[str, List[str]] = {}
        for cls_name, raw_sections in raw_map.items():
            cls_text = str(cls_name).strip()
            if not cls_text:
                continue
            out[cls_text] = ClientStaffService._normalize_scope_value_list(raw_sections)
        return out

    @classmethod
    def _normalize_assignment_scopes(cls, client: Client, raw_scopes: Any) -> List[Dict[str, Any]]:
        """Validate and normalize per-scope filters sent by assignment chips."""
        if not isinstance(raw_scopes, list):
            return []

        pending_scopes: List[Dict[str, Any]] = []
        requested_group_ids = set()
        requested_table_ids = set()

        for item in raw_scopes:
            if not isinstance(item, dict):
                continue

            scope_type = str(item.get('scope_type', '') or '').strip().lower()
            if scope_type not in ('group', 'table'):
                continue

            raw_scope_id = item.get('scope_id')
            if isinstance(raw_scope_id, bool):
                continue
            try:
                scope_id = int(str(raw_scope_id).strip())
            except (TypeError, ValueError):
                continue
            if scope_id <= 0:
                continue

            if scope_type == 'group':
                requested_group_ids.add(scope_id)
            else:
                requested_table_ids.add(scope_id)

            pending_scopes.append({
                'scope_type': scope_type,
                'scope_id': scope_id,
                'classes': cls._normalize_scope_value_list(item.get('classes', [])),
                'sections': cls._normalize_scope_value_list(item.get('sections', [])),
                'branches': cls._normalize_scope_value_list(item.get('branches', [])),
                'class_sections': cls._normalize_class_section_map(item.get('class_sections', {})),
            })

        valid_group_ids = set(
            IDCardGroup.objects.filter(
                client=client,
                id__in=list(requested_group_ids),
            ).values_list('id', flat=True)
        )

        valid_table_rows = list(
            IDCardTable.objects.filter(
                group__client=client,
                deleted_by_client=False,
                id__in=list(requested_table_ids),
            ).values_list('id', 'group_id')
        )
        valid_table_map = {int(tid): int(gid) for tid, gid in valid_table_rows}

        normalized_by_key: Dict[str, Dict[str, Any]] = {}
        for scope in pending_scopes:
            scope_type = scope['scope_type']
            scope_id = int(scope['scope_id'])

            if scope_type == 'group':
                if scope_id not in valid_group_ids:
                    continue
                group_id = scope_id
            else:
                group_id = valid_table_map.get(scope_id)
                if not group_id:
                    continue

            key = f'{scope_type}:{scope_id}'
            normalized_by_key[key] = {
                'scope_type': scope_type,
                'scope_id': scope_id,
                'group_id': int(group_id),
                'classes': scope['classes'],
                'sections': scope['sections'],
                'branches': scope['branches'],
                'class_sections': scope['class_sections'],
            }

        return sorted(
            normalized_by_key.values(),
            key=lambda s: (s['scope_type'], int(s['group_id']), int(s['scope_id'])),
        )

    @staticmethod
    def _scope_value_union(scopes: List[Dict[str, Any]]) -> Tuple[List[str], List[str], List[str]]:
        """Build legacy union lists from normalized scopes for compatibility."""
        classes, sections, branches = [], [], []
        seen_cls, seen_sec, seen_bra = set(), set(), set()

        for scope in scopes:
            class_sections = scope.get('class_sections') or {}
            if isinstance(class_sections, dict):
                for cls_name, raw_sections in class_sections.items():
                    key = str(cls_name).strip().lower()
                    if key and key not in seen_cls:
                        seen_cls.add(key)
                        classes.append(str(cls_name).strip())
                    for value in (raw_sections or []):
                        sec_key = str(value).strip().lower()
                        if sec_key and sec_key not in seen_sec:
                            seen_sec.add(sec_key)
                            sections.append(str(value).strip())

            for value in (scope.get('classes') or []):
                key = str(value).strip().lower()
                if key and key not in seen_cls:
                    seen_cls.add(key)
                    classes.append(str(value).strip())
            for value in (scope.get('sections') or []):
                key = str(value).strip().lower()
                if key and key not in seen_sec:
                    seen_sec.add(key)
                    sections.append(str(value).strip())
            for value in (scope.get('branches') or []):
                key = str(value).strip().lower()
                if key and key not in seen_bra:
                    seen_bra.add(key)
                    branches.append(str(value).strip())

        return classes, sections, branches
    
    @classmethod
    def can_manage_staff(cls, user) -> bool:
        """
        Check if user can manage client staff.
        Delegates to PermissionService.has() (single authority).
        """
        if not PermissionService.is_client(user):
            return False

        # Allow either the legacy client-list toggle or the newer manage-staff flag
        return (PermissionService.has(user, 'perm_idcard_client_list')
                or PermissionService.has(user, 'perm_manage_client_staff'))
    
    @classmethod
    def list_staff(cls, user) -> ServiceResult:
        """
        List all staff members for the client.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')

            staff_only_fields = [
                'id',
                'user',
                'created_at',
                'department',
                'designation',
                'assigned_table_ids',
                'allowed_classes',
                'allowed_sections',
                'assignment_scopes',
                'user__first_name',
                'user__last_name',
                'user__username',
                'user__email',
                'user__phone',
                'user__is_active',
            ] + list(cls.STAFF_PERMISSION_FIELDS)
            
            staff_list = Staff.objects.filter(
                client=client,
                staff_type='client_staff'
            ).select_related('user').only(*staff_only_fields).prefetch_related(
                Prefetch('assigned_groups', queryset=IDCardGroup.objects.only('id'))
            )
            
            staff_data = []
            for staff in staff_list:
                assigned_group_ids = [group.id for group in staff.assigned_groups.all()]
                item = {
                    'id': staff.id,
                    'user_id': staff.user.id,
                    'name': staff.user.get_full_name() or staff.user.username,
                    'email': cls._public_email(staff.user.email),
                    'phone': staff.user.phone or '',
                    'department': staff.department or '',
                    'designation': staff.designation or '',
                    'is_active': staff.user.is_active,
                    'created_at': staff.created_at.strftime('%d %b %Y'),
                    'assigned_group_ids': assigned_group_ids,
                    'assigned_table_ids': [
                        int(v) for v in (staff.assigned_table_ids or [])
                        if str(v).strip().isdigit() and int(v) > 0
                    ],
                    'allowed_classes': staff.allowed_classes or [],
                    'allowed_sections': staff.allowed_sections or [],
                    'assignment_scopes': staff.assignment_scopes or [],
                }
                # Include all permissions
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    item[perm] = getattr(staff, perm, False)
                staff_data.append(item)
            
            # Also include which permissions the client can grant
            client_permissions = {
                perm: getattr(client, perm, False)
                for perm in cls.STAFF_PERMISSION_FIELDS
            }
            
            return ServiceResult(success=True, data={
                'staff': staff_data,
                'client_permissions': client_permissions
            })
            
        except Exception as e:
            return cls._unexpected_error_result('list_staff', e)
    
    @classmethod
    def get_staff_detail(cls, user, staff_id: int) -> ServiceResult:
        """
        Get details of a specific staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            # Match the same gate as list/create/update/delete staff operations.
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            # Get staff and verify ownership
            try:
                staff = Staff.objects.select_related('user').prefetch_related(
                    Prefetch('assigned_groups', queryset=IDCardGroup.objects.only('id'))
                ).get(
                    id=staff_id, 
                    client=client, 
                    staff_type='client_staff'
                )
            except Staff.DoesNotExist:
                return ServiceResult(success=False, message='Staff not found')

            assigned_group_ids = [group.id for group in staff.assigned_groups.all()]
            
            # Include which permissions the client can grant
            client_permissions = {
                perm: getattr(client, perm, False)
                for perm in cls.STAFF_PERMISSION_FIELDS
            }
            
            detail = {
                'id': staff.id,
                'first_name': staff.user.first_name,
                'last_name': staff.user.last_name,
                'name': staff.user.get_full_name() or staff.user.username,
                'email': cls._public_email(staff.user.email),
                'phone': staff.user.phone or '',
                'department': staff.department or '',
                'designation': staff.designation or '',
                'address': staff.address or '',
                'is_active': staff.user.is_active,
                'status': 'active' if staff.user.is_active else 'inactive',
                'created_at': staff.created_at.strftime('%Y-%m-%dT%H:%M:%S'),
                'profile_image_url': None,  # profile_image removed in Phase 1 refactor
                'assigned_group_ids': assigned_group_ids,
                'assigned_table_ids': [
                    int(v) for v in (staff.assigned_table_ids or [])
                    if str(v).strip().isdigit() and int(v) > 0
                ],
                'allowed_classes': staff.allowed_classes or [],
                'allowed_sections': staff.allowed_sections or [],
                'allowed_branches': staff.allowed_branches or [],
                'assignment_scopes': staff.assignment_scopes or [],
                'client_permissions': client_permissions,
            }

            if not detail['assignment_scopes']:
                legacy_classes = list(staff.allowed_classes or [])
                legacy_sections = list(staff.allowed_sections or [])
                group_ids = list(staff.assigned_groups.values_list('id', flat=True))
                table_ids = [
                    int(v) for v in (staff.assigned_table_ids or [])
                    if str(v).strip().isdigit() and int(v) > 0
                ]

                if legacy_classes and legacy_sections:
                    scope_type = 'group'
                    scope_id = group_ids[0] if len(group_ids) == 1 else None
                    if scope_id is None and len(table_ids) == 1:
                        scope_type = 'table'
                        scope_id = table_ids[0]

                    if scope_id is not None:
                        if len(legacy_classes) == 1:
                            class_sections = {legacy_classes[0]: legacy_sections}
                        elif len(legacy_sections) == 1:
                            class_sections = {cls_name: legacy_sections for cls_name in legacy_classes}
                        else:
                            class_sections = {}

                        detail['assignment_scopes'] = [{
                            'scope_type': scope_type,
                            'scope_id': scope_id,
                            'group_id': group_ids[0] if group_ids else scope_id,
                            'classes': legacy_classes,
                            'sections': legacy_sections,
                            'branches': list(staff.allowed_branches or []),
                            'class_sections': class_sections,
                        }]

            # Include all permissions
            for perm in cls.STAFF_PERMISSION_FIELDS:
                detail[perm] = getattr(staff, perm, False)
            
            return ServiceResult(success=True, data=detail)
            
        except Exception as e:
            return cls._unexpected_error_result('get_staff_detail', e)
    
    @classmethod
    def create_staff(cls, user, data: Dict[str, Any]) -> ServiceResult:
        """
        Create a new client staff member.
        """
        try:
            send_welcome = False
            welcome_info = {}
            welcome_user_id = None
            welcome_email_log_id = None
            welcome_email_failed_reason = ''

            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')

            # Parse name - handle both formats: {name} or {first_name, last_name}
            first_name = str(data.get('first_name') or '').strip()
            last_name = str(data.get('last_name') or '').strip()
            if not first_name:
                # Fallback to parsing 'name' field
                name = str(data.get('name') or '').strip()
                name_parts = name.split() if name else []
                first_name = name_parts[0] if name_parts else ''
                last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

            display_name = f'{first_name} {last_name}'.strip()
            if not display_name:
                return ServiceResult(success=False, message='Name is required')

            raw_email = str(data.get('email') or '').strip().lower()
            if not raw_email:
                return ServiceResult(success=False, message='Email is required')

            # Check for duplicate email
            if User.objects.filter(email__iexact=raw_email).exists():
                return ServiceResult(
                    success=False,
                    message='A user with this email already exists'
                )
            email = raw_email

            # Generate username
            username = email.split('@')[0].lower().replace('.', '_')
            if not username:
                username = f'cstaff_{secrets.token_hex(4)}'
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
            
            # Password policy:
            # - if custom password is provided, use it
            # - otherwise phone number is required and used as password
            phone = str(data.get('phone') or '').strip()
            password = str(data.get('password') or '').strip()
            used_phone_as_password = False
            if not password:
                if phone:
                    password = phone
                    used_phone_as_password = True
                else:
                    return ServiceResult(
                        success=False,
                        message='Phone number is required when custom password is not provided'
                    )
            
            # Skip Django password validators when using phone as password
            if not used_phone_as_password:
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(password)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
            
            with transaction.atomic():
                # Create user
                is_active = cls.parse_bool(data.get('is_active', True))
                staff_user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                    role='client_staff',
                    is_active=is_active,
                )
                
                # Build staff kwargs
                staff_kwargs = {
                    'user': staff_user,
                    'staff_type': 'client_staff',
                    'client': client,
                    'department': data.get('department', ''),
                    'designation': data.get('designation', ''),
                    'address': data.get('address', ''),
                    'allowed_classes': [
                        str(v).strip() for v in (data.get('allowed_classes') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_classes', []), list) else [],
                    'allowed_sections': [
                        str(v).strip() for v in (data.get('allowed_sections') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_sections', []), list) else [],
                    'allowed_branches': [
                        str(v).strip() for v in (data.get('allowed_branches') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_branches', []), list) else [],
                }
                
                # Add permissions (only those the client themselves has)
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    if perm in data:
                        # Server-side enforcement: client can only grant perms they have
                        if getattr(client, perm, False):
                            staff_kwargs[perm] = cls.parse_bool(data[perm])
                        else:
                            staff_kwargs[perm] = False
                
                # Set default permissions for new client_staff (locked, enabled)
                # These are set as defaults if not explicitly provided in data
                if 'perm_idcard_pending_list' not in data:
                    if getattr(client, 'perm_idcard_pending_list', False):
                        staff_kwargs['perm_idcard_pending_list'] = True
                if 'perm_idcard_verified_list' not in data:
                    if getattr(client, 'perm_idcard_verified_list', False):
                        staff_kwargs['perm_idcard_verified_list'] = True
                if 'perm_idcard_pool_list' not in data:
                    if getattr(client, 'perm_idcard_pool_list', False):
                        staff_kwargs['perm_idcard_pool_list'] = True

                # Sensitive perms are never delegable to client_staff.
                for perm in cls.NON_DELEGABLE_CLIENT_STAFF_PERMS:
                    staff_kwargs[perm] = False
                
                staff = Staff.objects.create(**staff_kwargs)

                normalized_assignment_scopes = None
                if 'assignment_scopes' in data:
                    normalized_assignment_scopes = cls._normalize_assignment_scopes(
                        client,
                        data.get('assignment_scopes', []),
                    )

                scope_group_ids = sorted({
                    int(scope.get('group_id', 0) or 0)
                    for scope in (normalized_assignment_scopes or [])
                    if int(scope.get('group_id', 0) or 0) > 0
                })
                scope_table_ids = sorted({
                    int(scope.get('scope_id', 0) or 0)
                    for scope in (normalized_assignment_scopes or [])
                    if str(scope.get('scope_type', '')).lower() == 'table' and int(scope.get('scope_id', 0) or 0) > 0
                })

                # Assign groups if provided
                assigned_groups = data.get('assigned_groups', [])
                if (not assigned_groups) and normalized_assignment_scopes:
                    assigned_groups = scope_group_ids

                resolved_group_ids = []
                resolved_table_ids = []
                if assigned_groups:
                    resolved_group_ids, resolved_table_ids = cls._resolve_assignment_scope_ids(
                        client,
                        assigned_groups,
                        data.get('assignment_id_source', 'auto'),
                    )

                if normalized_assignment_scopes:
                    resolved_group_ids = sorted(set(resolved_group_ids) | set(scope_group_ids))
                    resolved_table_ids = sorted(set(resolved_table_ids) | set(scope_table_ids))

                if resolved_group_ids or resolved_table_ids:
                    valid_groups = IDCardGroup.objects.filter(
                        id__in=resolved_group_ids,
                        client=client,
                    )
                    staff.assigned_groups.set(valid_groups)
                    staff.assigned_table_ids = resolved_table_ids
                    staff.save(update_fields=['assigned_table_ids'])

                if normalized_assignment_scopes is not None:
                    valid_group_set = set(resolved_group_ids)
                    valid_table_set = set(resolved_table_ids)
                    filtered_scopes = []
                    for scope in normalized_assignment_scopes:
                        stype = scope.get('scope_type')
                        sid = int(scope.get('scope_id', 0) or 0)
                        if stype == 'group' and sid in valid_group_set:
                            filtered_scopes.append(scope)
                        elif stype == 'table' and sid in valid_table_set:
                            filtered_scopes.append(scope)

                    classes_u, sections_u, branches_u = cls._scope_value_union(filtered_scopes)
                    staff.assignment_scopes = filtered_scopes
                    staff.allowed_classes = classes_u
                    staff.allowed_sections = sections_u
                    staff.allowed_branches = branches_u
                    staff.save(update_fields=['assignment_scopes', 'allowed_classes', 'allowed_sections', 'allowed_branches'])

                if cls._has_real_email(email):
                    log = EmailLog.objects.create(
                        recipient_name=display_name or staff_user.get_full_name() or staff_user.username,
                        recipient_email=email,
                        subject='Welcome to Adarsh Admin - Your Account is Ready!',
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    )
                    welcome_email_log_id = log.pk

                    if is_active:
                        send_welcome = True
                        welcome_user_id = staff_user.pk
                        welcome_info = {
                            'name': display_name or staff_user.get_full_name() or staff_user.username,
                            'email': email,
                            'password': password,
                            'phone': phone,
                            'role': 'client_staff',
                        }

                transaction.on_commit(lambda cid=client.id: cls._bump_dashboard_cache_versions(cid))

            if send_welcome:
                _user_pk = welcome_user_id
                _log_id = welcome_email_log_id
                _email = welcome_info['email']

                def _on_email_success():
                    try:
                        User.objects.filter(pk=_user_pk).update(welcome_email_sent=True)
                        EmailLog.objects.filter(pk=_log_id).update(
                            status=EmailLog.STATUS_SENT,
                            sent_at=localtime(),
                            error_message='',
                        )
                    except Exception as cb_err:
                        logger.warning('Email success callback failed for %s: %s', _email, cb_err)

                def _on_email_failure(err_msg):
                    try:
                        EmailLog.objects.filter(pk=_log_id).update(
                            status=EmailLog.STATUS_FAILED,
                            error_message=str(err_msg),
                        )
                    except Exception as cb_err:
                        logger.warning('Email failure callback failed for %s: %s', _email, cb_err)

                try:
                    queued, queue_message = send_welcome_email(
                        name=welcome_info['name'],
                        email=welcome_info['email'],
                        password=welcome_info['password'],
                        role=welcome_info['role'],
                        phone=welcome_info['phone'],
                        request=None,
                        on_success=_on_email_success,
                        on_failure=_on_email_failure,
                    )
                except Exception as email_err:
                    queued = False
                    queue_message = str(email_err)

                if not queued:
                    welcome_email_failed_reason = queue_message or 'Failed to queue welcome email.'
                    _on_email_failure(welcome_email_failed_reason)

            email_sent = bool(send_welcome and not welcome_email_failed_reason)
            message = f'Staff member "{display_name}" created successfully!'
            if email_sent:
                message += ' Welcome email queued for delivery.'
            elif send_welcome and welcome_email_failed_reason:
                message += f' Welcome email could not be sent right now: {welcome_email_failed_reason}'
            elif not send_welcome and cls._has_real_email(email):
                message += ' Account is inactive; welcome email will be sent after activation.'
            
            return ServiceResult(
                success=True,
                message=message,
                data={'staff_id': staff.id, 'email_sent': email_sent}
            )
            
        except Exception as e:
            return cls._unexpected_error_result('create_staff', e)
    
    @classmethod
    def update_staff(cls, user, staff_id: int, data: Dict[str, Any]) -> ServiceResult:
        """
        Update a client staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            with transaction.atomic():
                # Get staff and verify ownership (row-lock for consistency)
                try:
                    staff = (
                        Staff.objects
                        .select_for_update()
                        .select_related('user')
                        .get(id=staff_id, client=client, staff_type='client_staff')
                    )
                except Staff.DoesNotExist:
                    return ServiceResult(success=False, message='Staff not found')

                normalized_assignment_scopes = None
                if 'assignment_scopes' in data:
                    normalized_assignment_scopes = cls._normalize_assignment_scopes(
                        client,
                        data.get('assignment_scopes', []),
                    )

                scope_group_ids = sorted({
                    int(scope.get('group_id', 0) or 0)
                    for scope in (normalized_assignment_scopes or [])
                    if int(scope.get('group_id', 0) or 0) > 0
                })
                scope_table_ids = sorted({
                    int(scope.get('scope_id', 0) or 0)
                    for scope in (normalized_assignment_scopes or [])
                    if str(scope.get('scope_type', '')).lower() == 'table' and int(scope.get('scope_id', 0) or 0) > 0
                })

                staff_user = staff.user

                # Update user fields - handle both name formats
                if 'first_name' in data:
                    staff_user.first_name = str(data['first_name'] or '').strip()
                if 'last_name' in data:
                    staff_user.last_name = str(data['last_name'] or '').strip()

                # Also handle combined 'name' field
                name = str(data.get('name') or '').strip()
                if name and 'first_name' not in data:
                    name_parts = name.split()
                    staff_user.first_name = name_parts[0] if name_parts else ''
                    staff_user.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

                if 'phone' in data:
                    staff_user.phone = data['phone']

                if 'is_active' in data:
                    staff_user.is_active = cls.parse_bool(data['is_active'])

                staff_user.save()

                # Update staff fields
                if 'department' in data:
                    staff.department = data['department']
                if 'designation' in data:
                    staff.designation = data['designation']
                if 'address' in data:
                    staff.address = data['address']

                # Update permissions (only those the client themselves has)
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    if perm in data:
                        # Server-side enforcement: client can only grant perms they have
                        if getattr(client, perm, False):
                            setattr(staff, perm, cls.parse_bool(data[perm]))
                        else:
                            setattr(staff, perm, False)

                # Sensitive perms are never delegable to client_staff.
                for perm in cls.NON_DELEGABLE_CLIENT_STAFF_PERMS:
                    setattr(staff, perm, False)

                # Update class/section filters if provided
                if 'allowed_classes' in data:
                    allowed_classes = data['allowed_classes']
                    if isinstance(allowed_classes, list):
                        staff.allowed_classes = [str(v).strip() for v in allowed_classes if isinstance(v, str)]
                if 'allowed_sections' in data:
                    allowed_sections = data['allowed_sections']
                    if isinstance(allowed_sections, list):
                        staff.allowed_sections = [str(v).strip() for v in allowed_sections if isinstance(v, str)]
                if 'allowed_branches' in data:
                    allowed_branches = data['allowed_branches']
                    if isinstance(allowed_branches, list):
                        staff.allowed_branches = [str(v).strip() for v in allowed_branches if isinstance(v, str)]

                staff.save()

                # Update group assignments if provided
                resolved_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
                resolved_table_ids = [
                    int(v) for v in (staff.assigned_table_ids or [])
                    if str(v).strip().isdigit() and int(v) > 0
                ]

                if ('assigned_groups' in data) or (normalized_assignment_scopes is not None):
                    explicit_assignment_payload = 'assigned_groups' in data
                    assignment_ids = data.get('assigned_groups', [])
                    if (not assignment_ids) and normalized_assignment_scopes:
                        assignment_ids = scope_group_ids

                    if assignment_ids:
                        resolved_group_ids, resolved_table_ids = cls._resolve_assignment_scope_ids(
                            client,
                            assignment_ids,
                            data.get('assignment_id_source', 'auto'),
                        )
                    elif explicit_assignment_payload and not normalized_assignment_scopes:
                        resolved_group_ids, resolved_table_ids = [], []

                    if normalized_assignment_scopes:
                        resolved_group_ids = sorted(set(resolved_group_ids) | set(scope_group_ids))
                        resolved_table_ids = sorted(set(resolved_table_ids) | set(scope_table_ids))

                    valid_groups = IDCardGroup.objects.filter(
                        id__in=resolved_group_ids,
                        client=client,
                    )
                    staff.assigned_groups.set(valid_groups)
                    staff.assigned_table_ids = resolved_table_ids
                    staff.save(update_fields=['assigned_table_ids'])

                if normalized_assignment_scopes is not None:
                    valid_group_set = set(int(v) for v in (resolved_group_ids or []))
                    valid_table_set = set(int(v) for v in (resolved_table_ids or []))
                    filtered_scopes = []
                    for scope in normalized_assignment_scopes:
                        stype = scope.get('scope_type')
                        sid = int(scope.get('scope_id', 0) or 0)
                        if stype == 'group' and sid in valid_group_set:
                            filtered_scopes.append(scope)
                        elif stype == 'table' and sid in valid_table_set:
                            filtered_scopes.append(scope)

                    classes_u, sections_u, branches_u = cls._scope_value_union(filtered_scopes)
                    staff.assignment_scopes = filtered_scopes
                    staff.allowed_classes = classes_u
                    staff.allowed_sections = sections_u
                    staff.allowed_branches = branches_u
                    staff.save(update_fields=['assignment_scopes', 'allowed_classes', 'allowed_sections', 'allowed_branches'])

                transaction.on_commit(lambda cid=client.id: cls._bump_dashboard_cache_versions(cid))
            
            return ServiceResult(
                success=True,
                message='Staff updated successfully!'
            )
            
        except Exception as e:
            return cls._unexpected_error_result('update_staff', e)
    
    @classmethod
    def toggle_staff_status(cls, user, staff_id: int) -> ServiceResult:
        """
        Toggle staff active/inactive status.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            with transaction.atomic():
                staff = Staff.objects.select_for_update().get(id=staff_id, client=client, staff_type='client_staff')
                staff_user = staff.user
                staff_user.is_active = not staff_user.is_active
                staff_user.save(update_fields=['is_active'])

                transaction.on_commit(lambda cid=client.id: cls._bump_dashboard_cache_versions(cid))
            
            status = 'active' if staff_user.is_active else 'inactive'
            
            return ServiceResult(
                success=True,
                message=f'Staff status changed to {status}!',
                data={'is_active': staff_user.is_active}
            )
            
        except Exception as e:
            return cls._unexpected_error_result('toggle_staff_status', e)
    
    @classmethod
    def delete_staff(cls, user, staff_id: int) -> ServiceResult:
        """
        Delete a client staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            # Get staff and verify ownership
            try:
                staff = Staff.objects.get(id=staff_id, client=client, staff_type='client_staff')
            except Staff.DoesNotExist:
                return ServiceResult(success=False, message='Staff not found')
            
            staff_name = staff.user.get_full_name() or staff.user.username
            staff_user = staff.user
            
            # Delete staff profile and user atomically
            with transaction.atomic():
                staff.delete()
                staff_user.delete()

            cls._bump_dashboard_cache_versions(client.id)
            
            return ServiceResult(
                success=True,
                message=f'Staff "{staff_name}" deleted successfully!'
            )
            
        except Exception as e:
            return cls._unexpected_error_result('delete_staff', e)

    @classmethod
    def set_temp_password(cls, user, staff_id: int, new_password: str, request=None) -> ServiceResult:
        """Set temporary password for a client-owned staff account."""
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            if not PermissionService.has(user, 'perm_set_temp_password'):
                return ServiceResult(success=False, message='Permission denied')

            staff = Staff.objects.filter(
                id=staff_id,
                client=client,
                staff_type='client_staff',
            ).first()
            if not staff:
                return ServiceResult(success=False, message='Staff not found')

            from core.services import StaffService

            return StaffService.set_temp_password(staff.id, new_password, request=request)

        except Exception as e:
            return cls._unexpected_error_result('set_temp_password', e)
