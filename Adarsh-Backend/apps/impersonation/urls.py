from django.urls import path
from apps.impersonation.views import ImpersonationViewSet

urlpatterns = [
    path('', ImpersonationViewSet.as_view({'post': 'create'}), name='impersonate'),
]
