from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.reprints.views import (
    ReprintRequestViewSet, ReprintDashboardView, ReprintReportView,
    ReprintExportSessionViewSet, DesktopReprintListView,
    DesktopReprintImageMetaView, DesktopReprintMarkPrintedView
)

router = DefaultRouter()
router.register(r'requests', ReprintRequestViewSet, basename='reprint-requests')
router.register(r'exports', ReprintExportSessionViewSet, basename='reprint-exports')

urlpatterns = [
    # Dashboard and reports
    path('dashboard/', ReprintDashboardView.as_view(), name='reprint-dashboard'),
    path('reports/', ReprintReportView.as_view(), name='reprint-reports'),

    # Desktop sync endpoints
    path('desktop/', DesktopReprintListView.as_view(), name='desktop-reprint-list'),
    path('desktop/<uuid:pk>/images/', DesktopReprintImageMetaView.as_view(), name='desktop-reprint-images'),
    path('desktop/printed/', DesktopReprintMarkPrintedView.as_view(), name='desktop-reprint-mark-printed'),

    # Default router endpoints
    path('', include(router.urls)),
]
