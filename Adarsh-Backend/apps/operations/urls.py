from django.urls import path
from apps.operations.views import OperationsDashboard

urlpatterns = [
    path('operations/dashboard/', OperationsDashboard.as_view(), name='operations_dashboard'),
]
