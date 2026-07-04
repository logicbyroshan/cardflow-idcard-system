from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError

from django.conf import settings
from shared.constants import Role

from apps.pro.models import BackupSession, BackupArtifact
from apps.pro.constants import BackupStatus
from apps.operations.models import BackupVerificationResult
from apps.operations.services import (
    BackupVerificationService,
    BackupRetentionPolicy,
    RestoreSimulationService,
    EnvironmentDiagnosticService,
    DeploymentValidationService,
    MigrationValidationService,
    DiskHealthService,
    MemoryHealthService,
)

def _require_pro(user):
    if user.role != Role.PRO_USER:
        raise PermissionDenied("Only PRO_USER can access operations dashboard.")

class OperationsDashboard(APIView):
    """
    GET /api/v1/operations/dashboard/
    Retrieves complete system health diagnostics, backup status, disk/memory usage,
    and database migrations validation.
    
    POST /api/v1/operations/dashboard/
    Allows running manual operational events (verification, cleanup, diagnostics, simulations).
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        _require_pro(request.user)
        
        # 1. Backup Status
        backups_qs = BackupSession.objects.all()
        backup_stats = {
            'total': backups_qs.count(),
            'completed': backups_qs.filter(status=BackupStatus.COMPLETED).count(),
            'failed': backups_qs.filter(status=BackupStatus.FAILED).count(),
            'processing': backups_qs.filter(status=BackupStatus.PROCESSING).count(),
        }
        
        # 2. Last Verification Result
        last_verification = BackupVerificationResult.objects.order_by('-verification_time').first()
        last_verification_data = None
        if last_verification:
            last_verification_data = {
                'id': str(last_verification.id),
                'verification_time': last_verification.verification_time,
                'status': last_verification.status,
                'error_details': last_verification.error_details,
                'file_name': last_verification.backup_artifact.file_name
            }
            
        # 3. Environment & Services status
        diagnostics = EnvironmentDiagnosticService.run_diagnostics()
        
        # 4. Migration status
        migration_check = MigrationValidationService.validate_migrations()
        
        # 5. Deployment validation
        deployment_check = DeploymentValidationService.validate_deployment()
        
        # 6. Disk & Memory current stats
        disk_current = DiskHealthService.check_disk_health()
        memory_current = MemoryHealthService.check_memory_health()
        
        return Response({
            'backup_status': backup_stats,
            'last_verification': last_verification_data,
            'storage_status': {
                'provider': getattr(settings, 'STORAGE_PROVIDER', 'unknown'),
                'health': diagnostics.get('storage', 'unknown')
            },
            'database_status': diagnostics.get('database', 'unknown'),
            'redis_status': diagnostics.get('redis', 'unknown'),
            'celery_status': diagnostics.get('celery', 'unknown'),
            'disk_usage': disk_current,
            'memory_usage': memory_current,
            'migration_status': migration_check,
            'deployment_status': deployment_check,
        })

    def post(self, request):
        _require_pro(request.user)
        
        action = request.data.get('action')
        if not action:
            raise ValidationError("An 'action' key is required.")
            
        if action == 'verify_backups':
            results = BackupVerificationService.verify_all_backups()
            return Response({'status': 'completed', 'verified_count': len(results), 'results': results})
            
        elif action == 'retention_cleanup':
            results = BackupRetentionPolicy.run_retention_cleanup()
            return Response({'status': 'completed', 'results': results})
            
        elif action == 'simulate_restore':
            artifact_id = request.data.get('artifact_id')
            if not artifact_id:
                raise ValidationError("An 'artifact_id' is required for restore simulation.")
            report = RestoreSimulationService.simulate_restore(artifact_id)
            return Response(report)
            
        elif action == 'diagnose':
            report = EnvironmentDiagnosticService.run_diagnostics()
            return Response({'status': 'completed', 'report': report})
            
        else:
            raise ValidationError(f"Unknown operations action: {action}")
