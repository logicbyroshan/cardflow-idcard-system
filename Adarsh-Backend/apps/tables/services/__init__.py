from apps.tables.models import Table
from apps.auditlogs.models import AuditLog, AuditEvent

class TableService:
    @staticmethod
    def create_table(organization_id: str, name: str, created_by) -> Table:
        table = Table.objects.create(organization_id=organization_id, name=name)
        AuditLog.objects.create(
            event_type=AuditEvent.TABLE_CREATED,
            actor=created_by,
            target_organization_id=organization_id,
            details={"table_id": str(table.id), "name": name}
        )
        return table
        
    @staticmethod
    def rename_table(table: Table, name: str, updated_by) -> Table:
        old_name = table.name
        table.name = name
        table.save()
        AuditLog.objects.create(
            event_type=AuditEvent.TABLE_UPDATED,
            actor=updated_by,
            target_organization_id=table.organization_id,
            details={"table_id": str(table.id), "old_name": old_name, "new_name": name, "action": "rename"}
        )
        return table

    @staticmethod
    def archive_table(table: Table, archived_by):
        from apps.tables.models import TableStatus
        table.status = TableStatus.ARCHIVED
        table.save()
        AuditLog.objects.create(
            event_type=AuditEvent.TABLE_UPDATED,
            actor=archived_by,
            target_organization_id=table.organization_id,
            details={"table_id": str(table.id), "name": table.name, "action": "archive"}
        )
        
    @staticmethod
    def delete_table(table: Table, deleted_by):
        table.soft_delete()
        AuditLog.objects.create(
            event_type=AuditEvent.TABLE_UPDATED,
            actor=deleted_by,
            target_organization_id=table.organization_id,
            details={"table_id": str(table.id), "name": table.name, "action": "delete"}
        )
