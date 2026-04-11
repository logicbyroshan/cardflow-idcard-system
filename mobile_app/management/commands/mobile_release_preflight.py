import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from mobile_app.views import _mobile_shell_app_config_payload


class Command(BaseCommand):
    help = "Run Android mobile-shell release preflight checks for final go/no-go signoff."

    def add_arguments(self, parser):
        parser.add_argument(
            '--strict',
            action='store_true',
            help='Return non-zero exit when preflight is not healthy.',
        )
        parser.add_argument(
            '--require-local-apk',
            action='store_true',
            help='Require local APK file presence when update URL points to a local path.',
        )

    def handle(self, *args, **options):
        strict = bool(options.get('strict'))
        require_local_apk = bool(options.get('require_local_apk'))

        checks = []

        min_build = int(getattr(settings, 'MOBILE_SHELL_ANDROID_MIN_BUILD', 1) or 1)
        latest_build = int(getattr(settings, 'MOBILE_SHELL_ANDROID_LATEST_BUILD', min_build) or min_build)
        latest_version = str(getattr(settings, 'MOBILE_SHELL_ANDROID_LATEST_VERSION', '1.0.0') or '1.0.0').strip()
        update_url = str(getattr(settings, 'MOBILE_SHELL_ANDROID_UPDATE_URL', '') or '').strip()
        support_url = str(getattr(settings, 'MOBILE_SHELL_SUPPORT_URL', '') or '').strip()

        checks.append(self._check(
            metric='build_threshold_order',
            passed=latest_build >= min_build,
            message='latest_build must be >= min_supported_build.',
            current={'min_build': min_build, 'latest_build': latest_build},
        ))

        checks.append(self._check(
            metric='latest_version_present',
            passed=bool(latest_version),
            message='latest_version must be non-empty.',
            current=latest_version,
        ))

        checks.append(self._check(
            metric='update_url_present',
            passed=bool(update_url),
            message='MOBILE_SHELL_ANDROID_UPDATE_URL is empty.',
            current=update_url,
        ))

        checks.append(self._check(
            metric='support_url_present',
            passed=bool(support_url),
            message='MOBILE_SHELL_SUPPORT_URL is empty.',
            current=support_url,
            severity='warn' if not support_url else 'fail',
        ))

        checks.append(self._check_update_url_resolves(update_url, require_local_apk=require_local_apk))

        config_preview = {
            'for_current_build': _mobile_shell_app_config_payload(app_build=latest_build),
            'for_legacy_build': _mobile_shell_app_config_payload(app_build=max(1, min_build - 1)),
        }

        healthy = all(check['status'] != 'fail' for check in checks)

        report = {
            'checks': checks,
            'healthy': healthy,
            'settings_snapshot': {
                'min_supported_build': min_build,
                'latest_build': latest_build,
                'latest_version': latest_version,
                'force_update': bool(getattr(settings, 'MOBILE_SHELL_ANDROID_FORCE_UPDATE', False)),
                'update_url': update_url,
                'support_url': support_url,
            },
            'config_preview': config_preview,
        }

        self.stdout.write(json.dumps(report, indent=2))

        if strict and not healthy:
            raise CommandError('Mobile shell release preflight failed.')

    def _check(self, *, metric, passed, message, current, severity='fail'):
        status = 'pass' if passed else ('warn' if severity == 'warn' else 'fail')
        return {
            'metric': metric,
            'status': status,
            'current': current,
            'message': 'OK' if passed else message,
        }

    def _check_update_url_resolves(self, update_url, *, require_local_apk=False):
        if not update_url:
            return self._check(
                metric='update_url_resolves',
                passed=False,
                message='No update URL to validate.',
                current=update_url,
            )

        is_remote = update_url.startswith('http://') or update_url.startswith('https://')
        if is_remote:
            return self._check(
                metric='update_url_resolves',
                passed=True,
                message='Remote update URL is set.',
                current=update_url,
            )

        repo_root = Path(__file__).resolve().parents[3]
        local_path = update_url
        if update_url.startswith('/'):
            local_path = update_url[1:]
        local_file = repo_root / local_path.replace('\\', '/')

        exists = local_file.exists()
        if exists:
            return self._check(
                metric='update_url_resolves',
                passed=True,
                message='Local update path exists.',
                current=str(local_file),
            )

        severity = 'fail' if require_local_apk else 'warn'
        return self._check(
            metric='update_url_resolves',
            passed=False,
            message='Local update path does not exist yet.',
            current=str(local_file),
            severity=severity,
        )
