from apps.fields.models import Field

class FieldSelector:
    @staticmethod
    def get_table_fields(table_id: str):
        return Field.objects.filter(table_id=table_id, is_deleted=False)

    @staticmethod
    def get_field(field_id: str):
        return Field.objects.filter(id=field_id, is_deleted=False).first()
