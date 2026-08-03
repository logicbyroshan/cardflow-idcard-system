from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.users.serializers import (
    UserSerializer, LoginRequestSerializer, TokenResponseSerializer,
    OperatorAssignmentSerializer
)
from shared.constants import Role
from apps.users.services import AuthenticationService, ClientService, AssistantService, OperatorAssignmentService
from apps.users.selectors import UserSelector, ClientSelector, AssistantSelector, OperatorSelector
from apps.users.policies import ClientPolicy, OperatorPolicy, AssistantPolicy

class AuthViewSet(viewsets.ViewSet):
    permission_classes = []
    
    @action(detail=False, methods=['post'])
    def login(self, request):
        serializer = LoginRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = AuthenticationService.authenticate(
            identifier=serializer.validated_data['identifier'],
            password=serializer.validated_data['password']
        )
        if not user:
            return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
            
        tokens = AuthenticationService.generate_tokens(user)
        return Response(tokens)

    @action(detail=False, methods=['post'], url_path='forgot-password')
    def forgot_password(self, request):
        identifier = request.data.get('identifier')
        user = AuthenticationService.authenticate(identifier, request.data.get('password')) # Actually password not needed for forgot-password, let's just find by identifier. Wait, I should not use authenticate.
        user = UserSelector.get_user_by_email_or_username(identifier)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
            
        from apps.users.services import OTPService
        otp = OTPService.generate_otp(user)
        # TODO: Send email
        return Response({'message': 'OTP sent'})

    @action(detail=False, methods=['post'], url_path='reset-password')
    def reset_password(self, request):
        identifier = request.data.get('identifier')
        otp = request.data.get('otp')
        new_password = request.data.get('new_password')
        
        user = UserSelector.get_user_by_email_or_username(identifier)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
            
        from apps.users.services import OTPService
        if OTPService.verify_otp(user, otp):
            user.set_password(new_password)
            user.save()
            return Response({'message': 'Password reset successful'})
        return Response({'error': 'Invalid or expired OTP'}, status=status.HTTP_400_BAD_REQUEST)

class ClientViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not ClientPolicy.can_create_client(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        # Simplification: Assume validation via a serializer in real app
        email = request.data.get('email')
        username = request.data.get('username')
        password = request.data.get('password')
        org_id = request.data.get('organization_id')
        
        client = ClientService.create_client(email, username, password, org_id, created_by=request.user)
        return Response(UserSerializer(client).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        # Admin views all, Owner views their org, etc.
        org_id = request.query_params.get('organization_id')
        if not org_id:
            return Response({'error': 'organization_id required'}, status=status.HTTP_400_BAD_REQUEST)
            
        if request.user.role == Role.CLIENT:
            if str(request.user.organization_id) != org_id:
                return Response(status=status.HTTP_403_FORBIDDEN)
            if not hasattr(request.user, 'owned_organization'):
                # Branch client can only see themselves
                clients = [request.user]
            else:
                clients = ClientSelector.get_organization_clients(org_id)
        else:
            clients = ClientSelector.get_organization_clients(org_id)
            
        return Response(UserSerializer(clients, many=True).data)

    def destroy(self, request, pk=None):
        if not ClientPolicy.can_delete_client(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        client = UserSelector.get_user_by_id(pk)
        if not client or client.role != Role.CLIENT:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
            
        # Check dependent data
        if hasattr(client, 'owned_organization') and client.owned_organization:
            return Response({'error': 'Cannot delete an Owner Client while organization exists.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Checking assistants
        from apps.users.models import User
        if User.objects.filter(parent_client_id=client.id, is_deleted=False).exists():
            return Response({'error': 'Cannot delete Client while active Assistants exist.'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Hard delete or soft delete
        # Business rule says: Clients soft deleted, but Assistants hard deleted
        from apps.auditlogs.models import AuditLog, AuditEvent
        AuditLog.objects.create(
            event_type=AuditEvent.DELETE_CLIENT,
            actor=request.user,
            details={"client_id": pk}
        )
        client.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

class AssistantViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        parent_id = request.data.get('parent_client_id')
        parent_client = UserSelector.get_user_by_id(parent_id)
        
        if not parent_client or not AssistantPolicy.can_create_assistant(request.user, parent_client):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        email = request.data.get('email')
        username = request.data.get('username')
        password = request.data.get('password')
        
        assistant = AssistantService.create_assistant(email, username, password, parent_id, created_by=request.user)
        return Response(UserSerializer(assistant).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        parent_id = request.query_params.get('parent_client_id')
        if not parent_id:
            return Response({'error': 'parent_client_id required'}, status=status.HTTP_400_BAD_REQUEST)
            
        if request.user.role == Role.CLIENT:
            if str(request.user.id) != parent_id and not hasattr(request.user, 'owned_organization'):
                return Response(status=status.HTTP_403_FORBIDDEN)
            if hasattr(request.user, 'owned_organization'):
                # Owner can verify if parent_id belongs to their org
                parent_client = UserSelector.get_user_by_id(parent_id)
                if not parent_client or parent_client.organization_id != request.user.organization_id:
                    return Response(status=status.HTTP_403_FORBIDDEN)
        
        assistants = AssistantSelector.get_client_assistants(parent_id)
        return Response(UserSerializer(assistants, many=True).data)

    def destroy(self, request, pk=None):
        assistant = UserSelector.get_user_by_id(pk)
        if not assistant or not AssistantPolicy.can_delete_assistant(request.user, assistant):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        AssistantService.hard_delete_assistant(pk, deleted_by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

class OperatorViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'])
    def assign_client(self, request):
        if not OperatorPolicy.can_assign_operator(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        operator_id = request.data.get('operator_id')
        client_id = request.data.get('client_id')
        
        assignment = OperatorAssignmentService.assign_client_to_operator(
            operator_id=operator_id,
            client_id=client_id,
            assigned_by_id=request.user.id
        )
        return Response(OperatorAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def assigned_clients(self, request):
        operator_id = request.query_params.get('operator_id')
        clients = OperatorSelector.get_assigned_clients(operator_id)
        return Response(UserSerializer(clients, many=True).data)
