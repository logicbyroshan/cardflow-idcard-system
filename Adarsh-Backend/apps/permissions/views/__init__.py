from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.users.selectors import UserSelector
from apps.permissions.services import PermissionService
from apps.permissions.serializers import OverridePermissionSerializer
from apps.permissions.policies import PermissionPolicy

class PermissionViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if not PermissionPolicy.can_manage_permissions(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
            
        serializer = OverridePermissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        target_user = UserSelector.get_user_by_id(serializer.validated_data['user_id'])
        if not target_user:
            return Response({'error': 'Target user not found'}, status=status.HTTP_404_NOT_FOUND)
            
        PermissionService.override_user_permission(
            user=target_user,
            permission_code=serializer.validated_data['permission_code'],
            is_granted=serializer.validated_data['is_granted']
        )
        return Response(status=status.HTTP_200_OK)

    def list(self, request):
        target_id = request.query_params.get('user_id')
        if not target_id:
            target_user = request.user
        else:
            target_user = UserSelector.get_user_by_id(target_id)
            if not target_user:
                return Response({'error': 'Target user not found'}, status=status.HTTP_404_NOT_FOUND)
                
        perms = PermissionService.get_user_permissions(target_user)
        return Response({'permissions': perms})
