from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.impersonation.services import ImpersonationService

class ImpersonationViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        target_id = request.data.get('target_user_id')
        if not target_id:
            return Response({'error': 'target_user_id required'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            tokens = ImpersonationService.get_impersonation_token(request.user, target_id)
            return Response(tokens)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
