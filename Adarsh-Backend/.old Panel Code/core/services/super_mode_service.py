"""Service layer for Pro-managed Super Mode assignments and runtime toggles."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone

from core.models import SuperModeAssignment, User

logger = logging.getLogger(__name__)


class SuperModeService:
    """Single authority for Super Mode assignment and runtime state."""

    MANAGEABLE_ROLES = {'super_admin', 'admin_staff'}
    SUPPORTED_ROLES = {'pro_user', 'super_admin'}
    _TRANSFER_RATE_LIMIT_KEYS = {'bulk_upload', 'reupload', 'export', 'export_all'}

    @classmethod
    def _tier_for_ram_mb(cls, ram_mb: int) -> int:
        """Map RAM allocation to a stable performance tier."""
        value = int(ram_mb or 0)
        if value >= 700:
            return 3
        if value >= 500:
            return 2
        if value >= 250:
            return 1
        return 0

    @classmethod
    def _effective_tier(cls, user: User) -> int:
        status = cls.build_status(user)
        if not status.get('effective_enabled'):
            return 0
        return cls._tier_for_ram_mb(int(status.get('ram_allocation_mb') or 0))

    @staticmethod
    def _role(user_or_role: Any) -> str:
        if isinstance(user_or_role, str):
            return str(user_or_role or '').strip().lower()
        return str(getattr(user_or_role, 'role', '') or '').strip().lower()

    @classmethod
    def allowed_options_for_role(cls, user_or_role: Any) -> List[int]:
        role = cls._role(user_or_role)
        return SuperModeAssignment.allowed_options_for_role(role)

    @classmethod
    def max_ram_for_role(cls, user_or_role: Any) -> int:
        options = cls.allowed_options_for_role(user_or_role)
        return max(options) if options else 0

    @classmethod
    def can_manage_assignments(cls, user: User) -> bool:
        return bool(user and user.is_authenticated and cls._role(user) in {'pro_user', 'super_admin'})

    @classmethod
    def _get_assignment(cls, user: User) -> Optional[SuperModeAssignment]:
        if not user or not getattr(user, 'is_authenticated', False):
            return None
        try:
            return user.super_mode_assignment
        except SuperModeAssignment.DoesNotExist:
            return None

    @classmethod
    def _get_or_create_assignment(cls, user: User) -> SuperModeAssignment:
        assignment, _ = SuperModeAssignment.objects.get_or_create(user=user)
        return assignment

    @classmethod
    def build_status(cls, user: User) -> Dict[str, Any]:
        role = cls._role(user)
        supported = role in cls.SUPPORTED_ROLES
        options = cls.allowed_options_for_role(role)

        assignment = cls._get_assignment(user)
        is_assigned = bool(assignment and assignment.is_assigned)
        is_enabled = bool(assignment and assignment.is_enabled)
        ram_mb = int(getattr(assignment, 'ram_allocation_mb', 0) or 0)
        effective_enabled = bool(is_assigned and is_enabled and ram_mb > 0)

        can_toggle = False
        if role in {'pro_user', 'super_admin'}:
            can_toggle = is_assigned and ram_mb > 0

        message = ''
        if not supported:
            message = 'Super Mode is not available for this account type.'
        elif role in {'super_admin', 'admin_staff'}:
            message = 'Super Mode is not available for this account type.'
        elif role in {'pro_user', 'super_admin'} and not is_assigned:
            message = 'Configure your own Super Mode RAM allocation from Pro Feature.'

        return {
            'role': role,
            'supported': supported,
            'can_manage_assignments': cls.can_manage_assignments(user),
            'can_toggle': bool(can_toggle),
            'is_assigned': is_assigned,
            'is_enabled': is_enabled,
            'effective_enabled': effective_enabled,
            'ram_allocation_mb': ram_mb,
            'max_ram_mb': cls.max_ram_for_role(role),
            'allowed_options_mb': options,
            'message': message,
        }

    @classmethod
    def is_effective_enabled(cls, user: User) -> bool:
        return bool(cls.build_status(user).get('effective_enabled'))

    @classmethod
    def get_effective_ram_mb(cls, user: User) -> int:
        status = cls.build_status(user)
        if not status.get('effective_enabled'):
            return 0
        return int(status.get('ram_allocation_mb') or 0)

    @classmethod
    def calculate_export_lock_boost(cls, user: User) -> int:
        """Return additional export lock slots based on active Super Mode."""
        status = cls.build_status(user)
        if not status.get('effective_enabled'):
            return 0

        ram_mb = int(status.get('ram_allocation_mb') or 0)
        role = str(status.get('role') or '')

        boost = max(0, cls._tier_for_ram_mb(ram_mb))

        role_cap = {
            'admin_staff': 1,
            'super_admin': 2,
            'pro_user': 3,
        }.get(role, 0)
        return max(0, min(boost, role_cap))

    @classmethod
    def allowed_concurrent_tasks(cls, user: User, task_type: Optional[str] = None) -> int:
        """Return per-user active task slot count for queue admission."""
        status = cls.build_status(user)
        if not status.get('effective_enabled'):
            return 1

        tier = cls._tier_for_ram_mb(int(status.get('ram_allocation_mb') or 0))
        role = str(status.get('role') or '')

        # Base boost: 250MB->2, 500MB->3, 700MB->4
        slots = 1 + tier

        # Keep role-specific safety caps.
        role_cap = {
            'admin_staff': 2,
            'super_admin': 3,
            'pro_user': 4,
        }.get(role, 1)
        slots = max(1, min(slots, role_cap))

        # Keep very heavy exports from over-saturating the worker.
        heavy_export_types = {'export_pdf', 'export_docx', 'export_zip'}
        if str(task_type or '').strip().lower() in heavy_export_types and slots > 3:
            slots = 3

        return slots

    @classmethod
    def upload_chunk_size_bytes(cls, user: User) -> int:
        """Chunk size for writing uploaded files to disk."""
        tier = cls._effective_tier(user)
        # Default remains 8 MB. Super Mode tiers increase I/O batch size.
        if tier >= 3:
            return 32 * 1024 * 1024
        if tier >= 2:
            return 24 * 1024 * 1024
        if tier >= 1:
            return 16 * 1024 * 1024
        return 8 * 1024 * 1024

    @classmethod
    def download_block_size_bytes(cls, user: User) -> int:
        """Streaming block size for download responses."""
        tier = cls._effective_tier(user)
        if tier >= 3:
            return 512 * 1024
        if tier >= 2:
            return 384 * 1024
        if tier >= 1:
            return 256 * 1024
        return 128 * 1024

    @classmethod
    def rate_limit_bonus(cls, user: User, key_prefix: str = '') -> int:
        """Extra request allowance for transfer-heavy endpoints only."""
        key = str(key_prefix or '').strip().lower()
        if key not in cls._TRANSFER_RATE_LIMIT_KEYS:
            return 0

        tier = cls._effective_tier(user)
        if tier <= 0:
            return 0

        if key == 'export_all':
            return min(3, tier)

        # bulk_upload / reupload / export
        return tier * 2

    @classmethod
    def build_task_metadata(cls, user: User) -> Dict[str, Any]:
        status = cls.build_status(user)
        tier = cls._tier_for_ram_mb(int(status.get('ram_allocation_mb') or 0)) if status.get('effective_enabled') else 0
        return {
            'super_mode_active': bool(status.get('effective_enabled')),
            'super_mode_ram_mb': int(status.get('ram_allocation_mb') or 0),
            'super_mode_role': str(status.get('role') or ''),
            'super_mode_tier': int(tier),
        }

    @classmethod
    def _validate_ram_for_role(cls, role: str, ram_mb: int) -> int:
        options = cls.allowed_options_for_role(role)
        if not options:
            raise ValueError('Super Mode is not supported for this role.')

        try:
            ram_val = int(ram_mb)
        except (TypeError, ValueError):
            raise ValueError('RAM allocation must be a valid integer value.') from None

        if ram_val not in options:
            options_text = ', '.join(str(v) for v in options)
            raise ValueError(f'Invalid RAM allocation for {role}. Allowed values: {options_text} MB.')

        return ram_val

    @classmethod
    @transaction.atomic
    def assign_user(
        cls,
        actor: User,
        target_user: User,
        *,
        enabled: bool,
        ram_mb: Optional[int] = None,
        runtime_enabled: Optional[bool] = None,
    ) -> SuperModeAssignment:
        """Assign or revoke Super Mode for super_admin/admin_staff users."""
        if not cls.can_manage_assignments(actor):
            raise PermissionError('Only admin users with Pro access can manage Super Mode assignments.')

        role = cls._role(target_user)
        if role not in cls.MANAGEABLE_ROLES:
            raise ValueError('Only Super Admin and Operator accounts can be assigned from this panel.')

        assignment = cls._get_or_create_assignment(target_user)
        now = timezone.now()

        if enabled:
            if ram_mb is None:
                raise ValueError('RAM allocation is required when enabling Super Mode.')
            ram_val = cls._validate_ram_for_role(role, ram_mb)
            assignment.is_assigned = True
            assignment.ram_allocation_mb = ram_val
            if runtime_enabled is None:
                # Keep user runtime preference if caller did not provide a runtime state.
                assignment.is_enabled = bool(assignment.is_enabled and assignment.is_assigned)
            else:
                assignment.is_enabled = bool(runtime_enabled and assignment.is_assigned)
        else:
            assignment.is_assigned = False
            assignment.is_enabled = False
            assignment.ram_allocation_mb = 0

        assignment.assigned_by = actor
        assignment.assigned_at = now
        assignment.full_clean()
        assignment.save()

        try:
            from core.services.activity_service import ActivityService

            mode_label = 'enabled' if enabled else 'disabled'
            ActivityService.log(
                'settings_update',
                f'Super Mode {mode_label} for {target_user.get_full_name() or target_user.username} ({target_user.role})',
                user=actor,
                target_model='User',
                target_id=target_user.id,
                target_name=target_user.username,
            )
        except Exception:
            logger.exception('Failed to log Super Mode assignment change')

        return assignment

    @classmethod
    @transaction.atomic
    def configure_pro_user_self(cls, actor: User, *, enabled: bool, ram_mb: int) -> SuperModeAssignment:
        """Configure Pro User self allocation (up to 750 MB) and runtime state."""
        role = cls._role(actor)
        if role not in {'pro_user', 'super_admin'}:
            raise PermissionError('Only Pro User or Super Admin can configure self Super Mode settings.')

        ram_val = cls._validate_ram_for_role(role, ram_mb)

        assignment = cls._get_or_create_assignment(actor)
        assignment.is_assigned = True
        assignment.is_enabled = bool(enabled)
        assignment.ram_allocation_mb = ram_val
        assignment.assigned_by = actor
        assignment.assigned_at = timezone.now()
        assignment.full_clean()
        assignment.save()

        try:
            from core.services.activity_service import ActivityService

            state = 'enabled' if enabled else 'disabled'
            ActivityService.log(
                'settings_update',
                f'Pro User updated own Super Mode ({ram_val} MB, {state})',
                user=actor,
                target_model='User',
                target_id=actor.id,
                target_name=actor.username,
            )
        except Exception:
            logger.exception('Failed to log Pro User self Super Mode update')

        return assignment

    @classmethod
    @transaction.atomic
    def toggle_runtime(cls, user: User, *, enabled: bool) -> SuperModeAssignment:
        """Toggle runtime Super Mode state for current user."""
        role = cls._role(user)
        # Allow toggling runtime for Pro Users, and for manageable roles
        # (super_admin/admin_staff) when they have an assigned Super Mode.
        if role not in cls.SUPPORTED_ROLES and role not in cls.MANAGEABLE_ROLES:
            raise PermissionError('Super Mode is not available for this account.')

        assignment = cls._get_assignment(user)
        if assignment is None:
            raise ValueError('Super Mode is not assigned for this account.')

        if not assignment.is_assigned or int(assignment.ram_allocation_mb or 0) <= 0:
            raise ValueError('Super Mode is not assigned for this account.')

        assignment.is_enabled = bool(enabled)
        assignment.full_clean()
        assignment.save(update_fields=['is_enabled', 'updated_at'])

        try:
            from core.services.activity_service import ActivityService

            state = 'enabled' if enabled else 'disabled'
            ActivityService.log(
                'settings_update',
                f'Super Mode turned {state} ({assignment.ram_allocation_mb} MB)',
                user=user,
                target_model='User',
                target_id=user.id,
                target_name=user.username,
            )
        except Exception:
            logger.exception('Failed to log runtime Super Mode toggle')

        return assignment

    @classmethod
    def list_manageable_users(cls) -> List[Dict[str, Any]]:
        """List users Pro User can assign (super_admin + admin_staff) with assignment status."""
        users = list(
            User.objects.filter(role__in=sorted(cls.MANAGEABLE_ROLES))
            .order_by('role', 'first_name', 'username', 'id')
        )

        assignment_map = {
            row.user_id: row
            for row in SuperModeAssignment.objects.filter(user__in=users)
            .select_related('assigned_by')
        }

        payload: List[Dict[str, Any]] = []
        for user in users:
            assignment = assignment_map.get(user.id)
            payload.append({
                'id': user.id,
                'full_name': (user.get_full_name() or user.username or user.email or f'User {user.id}').strip(),
                'username': user.username,
                'email': user.email,
                'role': user.role,
                'role_display': user.get_role_display() if hasattr(user, 'get_role_display') else user.role,
                'is_active': bool(user.is_active),
                'super_mode': {
                    'is_assigned': bool(assignment and assignment.is_assigned),
                    'is_enabled': bool(assignment and assignment.is_enabled),
                    'effective_enabled': bool(assignment and assignment.effective_enabled),
                    'ram_allocation_mb': int(getattr(assignment, 'ram_allocation_mb', 0) or 0),
                    'assigned_by': (
                        assignment.assigned_by.get_full_name() or assignment.assigned_by.username
                    ) if assignment and assignment.assigned_by else '',
                    'assigned_at': assignment.assigned_at.isoformat() if assignment and assignment.assigned_at else None,
                    'allowed_options_mb': cls.allowed_options_for_role(user.role),
                    'max_ram_mb': cls.max_ram_for_role(user.role),
                },
            })

        return payload

    @classmethod
    def parse_bool(cls, value: Any, *, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}

    @classmethod
    def parse_int(cls, value: Any, *, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
