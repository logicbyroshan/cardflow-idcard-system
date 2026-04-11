import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Max
from django.utils import timezone

from mobile_app.models import MobileDevice


class Command(BaseCommand):
    help = "Evaluate Android rollout health gates for mobile shell releases."

    CRASH_FREE_SESSIONS_MIN = 99.0
    ANR_RATE_MAX = 0.47
    FAILURE_RATE_MULTIPLIER_MAX = 2.0

    def add_arguments(self, parser):
        parser.add_argument(
            '--crash-free-sessions',
            type=float,
            default=None,
            help='Crash-free sessions percentage from Play Console (example: 99.3).',
        )
        parser.add_argument(
            '--anr-rate',
            type=float,
            default=None,
            help='ANR percentage from Play Console (example: 0.31).',
        )
        parser.add_argument(
            '--auth-failure-rate',
            type=float,
            default=None,
            help='Current auth failure rate percentage.',
        )
        parser.add_argument(
            '--auth-failure-baseline',
            type=float,
            default=None,
            help='Baseline auth failure rate percentage.',
        )
        parser.add_argument(
            '--upload-failure-rate',
            type=float,
            default=None,
            help='Current upload failure rate percentage.',
        )
        parser.add_argument(
            '--upload-failure-baseline',
            type=float,
            default=None,
            help='Baseline upload failure rate percentage.',
        )
        parser.add_argument(
            '--max-stale-30d',
            type=int,
            default=None,
            help='Optional max allowed stale devices (last_seen >30 days).',
        )
        parser.add_argument(
            '--include-inactive',
            action='store_true',
            help='Include inactive devices in snapshot counts.',
        )
        parser.add_argument(
            '--strict',
            action='store_true',
            help='Return non-zero exit when any provided gate fails.',
        )

    def handle(self, *args, **options):
        now = timezone.now()
        include_inactive = bool(options.get('include_inactive'))
        strict = bool(options.get('strict'))

        base_qs = MobileDevice.objects.filter(platform='android')
        if not include_inactive:
            base_qs = base_qs.filter(is_active=True)

        device_snapshot = {
            'include_inactive': include_inactive,
            'total_devices': base_qs.count(),
            'active_24h': base_qs.filter(last_seen_at__gte=now - timedelta(hours=24)).count(),
            'active_7d': base_qs.filter(last_seen_at__gte=now - timedelta(days=7)).count(),
            'stale_30d': base_qs.filter(last_seen_at__lt=now - timedelta(days=30)).count(),
            'last_seen_at': base_qs.aggregate(last_seen=Max('last_seen_at')).get('last_seen'),
            'top_builds': list(
                base_qs.exclude(app_build__lte=0)
                .values('app_build', 'app_version')
                .annotate(total=Count('id'))
                .order_by('-app_build', '-total')[:5]
            ),
        }

        checks = []

        self._append_threshold_check(
            checks,
            key='crash_free_sessions',
            metric=options.get('crash_free_sessions'),
            threshold=f'>= {self.CRASH_FREE_SESSIONS_MIN}',
            evaluator=lambda value: value >= self.CRASH_FREE_SESSIONS_MIN,
            failure_message='Crash-free sessions below threshold.',
        )
        self._append_threshold_check(
            checks,
            key='anr_rate',
            metric=options.get('anr_rate'),
            threshold=f'<= {self.ANR_RATE_MAX}',
            evaluator=lambda value: value <= self.ANR_RATE_MAX,
            failure_message='ANR rate above threshold.',
        )
        self._append_ratio_check(
            checks,
            key='auth_failure_rate',
            current=options.get('auth_failure_rate'),
            baseline=options.get('auth_failure_baseline'),
        )
        self._append_ratio_check(
            checks,
            key='upload_failure_rate',
            current=options.get('upload_failure_rate'),
            baseline=options.get('upload_failure_baseline'),
        )

        max_stale_30d = options.get('max_stale_30d')
        if max_stale_30d is not None:
            max_stale_30d = max(0, int(max_stale_30d))
            current_stale = int(device_snapshot['stale_30d'])
            checks.append({
                'metric': 'stale_30d',
                'status': 'pass' if current_stale <= max_stale_30d else 'fail',
                'current': current_stale,
                'threshold': f'<= {max_stale_30d}',
                'message': 'Stale device count exceeded limit.' if current_stale > max_stale_30d else 'Within stale-device threshold.',
            })

        healthy = all(check['status'] != 'fail' for check in checks)

        report = {
            'generated_at': now.isoformat(),
            'thresholds': {
                'crash_free_sessions_min': self.CRASH_FREE_SESSIONS_MIN,
                'anr_rate_max': self.ANR_RATE_MAX,
                'failure_rate_multiplier_max': self.FAILURE_RATE_MULTIPLIER_MAX,
            },
            'device_snapshot': {
                **device_snapshot,
                'last_seen_at': device_snapshot['last_seen_at'].isoformat() if device_snapshot['last_seen_at'] else None,
            },
            'checks': checks,
            'healthy': healthy,
        }

        self.stdout.write(json.dumps(report, indent=2))

        if strict and not healthy:
            raise CommandError('Rollout guard checks failed; thresholds not met.')

    def _append_threshold_check(self, checks, *, key, metric, threshold, evaluator, failure_message):
        if metric is None:
            checks.append({
                'metric': key,
                'status': 'skipped',
                'current': None,
                'threshold': threshold,
                'message': 'Metric not provided.',
            })
            return

        passed = evaluator(metric)
        checks.append({
            'metric': key,
            'status': 'pass' if passed else 'fail',
            'current': metric,
            'threshold': threshold,
            'message': 'Within threshold.' if passed else failure_message,
        })

    def _append_ratio_check(self, checks, *, key, current, baseline):
        threshold = f'<= {self.FAILURE_RATE_MULTIPLIER_MAX}x baseline'
        if current is None or baseline is None:
            checks.append({
                'metric': key,
                'status': 'skipped',
                'current': current,
                'baseline': baseline,
                'threshold': threshold,
                'message': 'Current and baseline values are both required.',
            })
            return

        if baseline <= 0:
            checks.append({
                'metric': key,
                'status': 'fail',
                'current': current,
                'baseline': baseline,
                'threshold': threshold,
                'message': 'Baseline must be greater than zero.',
            })
            return

        multiplier = current / baseline
        passed = multiplier <= self.FAILURE_RATE_MULTIPLIER_MAX
        checks.append({
            'metric': key,
            'status': 'pass' if passed else 'fail',
            'current': current,
            'baseline': baseline,
            'multiplier': round(multiplier, 4),
            'threshold': threshold,
            'message': 'Within threshold.' if passed else 'Failure rate exceeds allowed multiplier.',
        })
