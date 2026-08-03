from typing import Optional
from apps.tables.models import Table, TableStatus

class TableSelector:
    @staticmethod
    def get_table(table_id: str) -> Optional[Table]:
        return Table.objects.filter(id=table_id, is_deleted=False).first()

    @staticmethod
    def get_org_tables(org_id: str):
        return Table.objects.filter(organization_id=org_id, is_deleted=False)
