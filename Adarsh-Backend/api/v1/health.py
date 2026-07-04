from rest_framework.views import APIView
from rest_framework.response import Response
from django.db import connection
from django.core.cache import cache

class HealthCheckView(APIView):
    permission_classes = []
    def get(self, request):
        return Response({"status": "ok", "service": "Adarsh-ID Panel"})

class ReadinessCheckView(APIView):
    permission_classes = []
    def get(self, request):
        status = "ok"
        components = {}
        # Check DB
        try:
            connection.ensure_connection()
            components['database'] = "ok"
        except Exception as e:
            status = "error"
            components['database'] = str(e)
        # Check Redis
        try:
            cache.set('health_check', 'ok', timeout=1)
            components['redis'] = "ok"
        except Exception as e:
            status = "error"
            components['redis'] = str(e)
            
        response_status = 200 if status == "ok" else 503
        return Response({"status": status, "components": components}, status=response_status)

class LivenessCheckView(APIView):
    permission_classes = []
    def get(self, request):
        return Response({"status": "ok"})