from rest_framework_simplejwt.tokens import RefreshToken
from apps.users.models import User
from apps.users.repositories import UserRepository
from shared.constants import Role

class ImpersonationService:
    @staticmethod
    def get_impersonation_token(pro_user: User, target_user_id: str) -> dict:
        if pro_user.role != Role.PRO_USER:
            raise ValueError("Only Pro Users can impersonate")
            
        target_user = UserRepository.get_by_id(target_user_id)
        if not target_user:
            raise ValueError("Target user not found")
            
        refresh = RefreshToken.for_user(target_user)
        refresh['impersonated_by'] = str(pro_user.id)
        
        return {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }
