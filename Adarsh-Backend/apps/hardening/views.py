import time
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from apps.hardening.services import (
    DatabaseHealthService,
    RedisHealthService,
    CeleryHealthService,
    StorageHealthService,
)

class LivenessCheckView(APIView):
    """
    GET /health/live/
    Liveness probe. Returns 200 OK immediately if web server is up.
    """
    permission_classes = [AllowAny]
    authentication_classes = []
    
    def get(self, request):
        return Response({"status": "ok"})


class RootHealthView(APIView):
    """
    GET /health/
    Aggregated health check endpoint. Probes all core systems.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        start_time = time.monotonic()
        
        db_result = DatabaseHealthService.check_health()
        redis_result = RedisHealthService.check_health()
        celery_result = CeleryHealthService.check_health()
        storage_result = StorageHealthService.check_health()
        
        is_healthy = all(
            r['status'] == 'ok' 
            for r in [db_result, redis_result, celery_result, storage_result]
        )
        
        overall_status = "ok" if is_healthy else "error"
        http_status = status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
        
        latency = (time.monotonic() - start_time) * 1000
        
        return Response({
            'status': overall_status,
            'latency_ms': round(latency, 2),
            'services': {
                'database': db_result,
                'redis': redis_result,
                'celery': celery_result,
                'storage': storage_result,
            }
        }, status=http_status)


class DatabaseHealthView(APIView):
    """GET /health/db/"""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        res = DatabaseHealthService.check_health()
        http_status = status.HTTP_200_OK if res['status'] == 'ok' else status.HTTP_503_SERVICE_UNAVAILABLE
        res['latency_ms'] = round(res['latency_ms'], 2)
        return Response(res, status=http_status)


class RedisHealthView(APIView):
    """GET /health/redis/"""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        res = RedisHealthService.check_health()
        http_status = status.HTTP_200_OK if res['status'] == 'ok' else status.HTTP_503_SERVICE_UNAVAILABLE
        res['latency_ms'] = round(res['latency_ms'], 2)
        return Response(res, status=http_status)


class CeleryHealthView(APIView):
    """GET /health/celery/"""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        res = CeleryHealthService.check_health()
        http_status = status.HTTP_200_OK if res['status'] == 'ok' else status.HTTP_503_SERVICE_UNAVAILABLE
        res['latency_ms'] = round(res['latency_ms'], 2)
        return Response(res, status=http_status)


class StorageHealthView(APIView):
    """GET /health/storage/"""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        res = StorageHealthService.check_health()
        http_status = status.HTTP_200_OK if res['status'] == 'ok' else status.HTTP_503_SERVICE_UNAVAILABLE
        res['latency_ms'] = round(res['latency_ms'], 2)
        return Response(res, status=http_status)
