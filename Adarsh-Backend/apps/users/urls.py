from django.urls import path
from apps.users.views import AuthViewSet, ClientViewSet, AssistantViewSet, OperatorViewSet

urlpatterns = [
    path('auth/login/', AuthViewSet.as_view({'post': 'login'}), name='auth-login'),
    path('auth/forgot-password/', AuthViewSet.as_view({'post': 'forgot_password'}), name='auth-forgot'),
    path('auth/reset-password/', AuthViewSet.as_view({'post': 'reset_password'}), name='auth-reset'),
    
    path('clients/', ClientViewSet.as_view({'get': 'list', 'post': 'create'}), name='clients'),
    path('clients/<uuid:pk>/', ClientViewSet.as_view({'delete': 'destroy'}), name='clients-detail'),
    
    path('assistants/', AssistantViewSet.as_view({'get': 'list', 'post': 'create'}), name='assistants-list'),
    path('assistants/<uuid:pk>/', AssistantViewSet.as_view({'delete': 'destroy'}), name='assistants-detail'),
    
    path('operators/assign/', OperatorViewSet.as_view({'post': 'assign_client'}), name='operators-assign'),
    path('operators/clients/', OperatorViewSet.as_view({'get': 'assigned_clients'}), name='operators-clients'),
]
