from typing import Optional, List
from django.contrib.auth.hashers import check_password
from rest_framework_simplejwt.tokens import RefreshToken
from apps.users.models import User, OperatorAssignment
from apps.users.repositories import UserRepository, ClientRepository, AssistantRepository, OperatorAssignmentRepository
from apps.permissions.repositories import PermissionRepository
from apps.auditlogs.models import AuditLog, AuditEvent
from shared.constants import Role, PermissionCode
import random
from datetime import timedelta
from django.utils import timezone

class AuthenticationService:
    @staticmethod
    def authenticate(identifier: str, password: str) -> Optional[User]:
        user = UserRepository.get_by_email(identifier)
        if not user:
            user = UserRepository.get_by_username(identifier)
        
        if user and check_password(password, user.password):
            return user
        return None

    @staticmethod
    def generate_tokens(user: User) -> dict:
        refresh = RefreshToken.for_user(user)
        return {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }

class UserService:
    @staticmethod
    def get_user_permissions(user: User) -> List[str]:
        if user.role == Role.PRO_USER:
            # Pro user has all permissions
            from apps.permissions.models import Permission
            return list(Permission.objects.values_list('code', flat=True))
        return PermissionRepository.get_user_permissions(user)

class ClientService:
    @staticmethod
    def create_client(email: str, username: str, password: str, organization_id: str, is_owner: bool = False, created_by: User = None) -> User:
        user = UserRepository.create_user(
            role=Role.CLIENT,
            email=email,
            username=username,
            password=password,
            organization_id=organization_id
        )
        if created_by and created_by.role == Role.OPERATOR:
            OperatorAssignmentService.assign_client_to_operator(created_by.id, user.id, created_by.id)
            
        AuditLog.objects.create(
            event_type=AuditEvent.CREATE_CLIENT,
            actor=created_by,
            target_user=user,
            target_organization_id=organization_id,
            details={"is_owner": is_owner}
        )
        return user

class AssistantService:
    @staticmethod
    def create_assistant(email: str, username: str, password: str, parent_client_id: str, created_by: User = None) -> User:
        user = UserRepository.create_user(
            role=Role.ASSISTANT,
            email=email,
            username=username,
            password=password,
            parent_client_id=parent_client_id
        )
        AuditLog.objects.create(
            event_type=AuditEvent.CREATE_ASSISTANT,
            actor=created_by,
            target_user=user,
            details={"parent_client_id": parent_client_id}
        )
        return user

    @staticmethod
    def hard_delete_assistant(assistant_id: str, deleted_by: User = None) -> bool:
        assistant = AssistantRepository.get_by_id(assistant_id)
        if assistant:
            AuditLog.objects.create(
                event_type=AuditEvent.DELETE_ASSISTANT,
                actor=deleted_by,
                details={"assistant_email": assistant.email, "assistant_id": assistant_id}
            )
            AssistantRepository.hard_delete(assistant)
            return True
        return False

class OperatorAssignmentService:
    @staticmethod
    def assign_client_to_operator(operator_id: str, client_id: str, assigned_by_id: str) -> OperatorAssignment:
        operator = UserRepository.get_by_id(operator_id)
        client = ClientRepository.get_by_id(client_id)
        assigned_by = UserRepository.get_by_id(assigned_by_id)
        
        if not operator or not client or not assigned_by:
            raise ValueError("Invalid user references")
            
        assignment = OperatorAssignmentRepository.create_assignment(operator, client, assigned_by)
        AuditLog.objects.create(
            event_type=AuditEvent.ASSIGN_OPERATOR,
            actor=assigned_by,
            target_user=client,
            details={"operator_id": operator_id}
        )
        return assignment

class OTPService:
    @staticmethod
    def generate_otp(user: User) -> str:
        from apps.users.models import OTPToken
        otp_code = str(random.randint(100000, 999999))
        OTPToken.objects.filter(user=user, is_used=False).update(is_used=True) # invalidate old
        OTPToken.objects.create(
            user=user,
            otp=otp_code,
            expires_at=timezone.now() + timedelta(minutes=10)
        )
        return otp_code

    @staticmethod
    def verify_otp(user: User, otp: str) -> bool:
        from apps.users.models import OTPToken
        token = OTPToken.objects.filter(
            user=user, 
            otp=otp, 
            is_used=False, 
            expires_at__gt=timezone.now()
        ).first()
        if token:
            token.is_used = True
            token.save()
            return True
        return False
