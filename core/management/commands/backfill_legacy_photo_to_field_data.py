"""
One-time backfill: copy legacy IDCard.photo paths into table image field_data.

Why:
- Older mobile camera uploads wrote only to legacy `card.photo`.
- Desktop ID-card tables render image columns from `field_data` image keys.

Safety rules:
- Dry-run by default (no DB writes).
- Never overwrite an existing non-empty image value in field_data.
- Only updates cards that have legacy photo + a table image field.

Usage:
    python manage.py backfill_legacy_photo_to_field_data
    python manage.py backfill_legacy_photo_to_field_data --apply
    python manage.py backfill_legacy_photo_to_field_data --apply --client-id 12
"""

import re
from typing import Optional

from django.core.management.base import BaseCommand

from core.services.base import BaseService
from idcards.models import IDCard
from mediafiles.services import ImageService


class Command(BaseCommand):
    help = (
        "Backfill legacy IDCard.photo into field_data image field without overwriting existing field_data images."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            default=False,
            help="Actually write changes to DB. Default is dry-run.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=500,
            help="Bulk update batch size. Default: 500",
        )
        parser.add_argument(
            "--client-id",
            type=int,
            default=None,
            help="Optional: limit to one client id.",
        )
        parser.add_argument(
            "--table-id",
            type=int,
            default=None,
            help="Optional: limit to one table id.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        batch_size = max(1, int(options["batch_size"] or 500))
        client_id = options.get("client_id")
        table_id = options.get("table_id")

        mode = "APPLY" if apply else "DRY-RUN"
        self.stdout.write(f"\n=== backfill_legacy_photo_to_field_data ({mode}) ===\n")

        qs = (
            IDCard.objects.select_related("table")
            .exclude(photo__isnull=True)
            .exclude(photo="")
            .only("id", "photo", "field_data", "table__id", "table__fields")
        )
        if client_id:
            qs = qs.filter(table__group__client_id=client_id)
        if table_id:
            qs = qs.filter(table_id=table_id)

        total_candidates = qs.count()
        self.stdout.write(f"Candidates with legacy photo: {total_candidates}")

        scanned = 0
        updated = 0
        skipped_no_image_field = 0
        skipped_has_field_data_image = 0
        skipped_empty_legacy_path = 0

        pending = []

        for card in qs.iterator(chunk_size=batch_size):
            scanned += 1

            table_fields = card.table.fields or []
            target_field = self._pick_target_image_field(table_fields)
            if not target_field:
                skipped_no_image_field += 1
                continue

            field_data = card.field_data if isinstance(card.field_data, dict) else {}
            existing_val = self._get_field_value_case_insensitive(field_data, target_field)
            if self._has_meaningful_image_value(existing_val):
                skipped_has_field_data_image += 1
                continue

            legacy_raw = getattr(card.photo, "name", None) or str(card.photo or "")
            legacy_path = BaseService.normalize_image_path(legacy_raw)
            if not legacy_path:
                skipped_empty_legacy_path += 1
                continue

            field_data[target_field] = legacy_path
            card.field_data = field_data
            pending.append(card)
            updated += 1

            if apply and len(pending) >= batch_size:
                IDCard.objects.bulk_update(pending, ["field_data"], batch_size=batch_size)
                pending.clear()

        if apply and pending:
            IDCard.objects.bulk_update(pending, ["field_data"], batch_size=batch_size)

        self.stdout.write("\nSummary")
        self.stdout.write(f"  Scanned: {scanned}")
        self.stdout.write(f"  Will update/Updated: {updated}")
        self.stdout.write(f"  Skipped (no image field on table): {skipped_no_image_field}")
        self.stdout.write(f"  Skipped (already has field_data image): {skipped_has_field_data_image}")
        self.stdout.write(f"  Skipped (empty legacy path): {skipped_empty_legacy_path}")

        if apply:
            self.stdout.write(self.style.SUCCESS(f"\nDone. Updated {updated} card(s)."))
        else:
            self.stdout.write(self.style.WARNING("\nDry-run only. Re-run with --apply to persist changes."))

    @staticmethod
    def _pick_target_image_field(table_fields) -> Optional[str]:
        names = ImageService.get_image_field_names(table_fields or [])
        if not names:
            return None

        for name in names:
            if re.search(r"\bphoto\b", str(name or ""), re.IGNORECASE):
                return name

        for name in names:
            if "photo" in str(name or "").lower():
                return name

        return names[0]

    @staticmethod
    def _get_field_value_case_insensitive(field_data: dict, field_name: str):
        if not isinstance(field_data, dict):
            return ""
        if field_name in field_data:
            return field_data.get(field_name)

        wanted = str(field_name or "").strip().lower()
        for key, value in field_data.items():
            if str(key).strip().lower() == wanted:
                return value
        return ""

    @staticmethod
    def _has_meaningful_image_value(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        if not text:
            return False
        if text == "NOT_FOUND":
            return False
        if text.startswith("PENDING:"):
            return False
        return True
