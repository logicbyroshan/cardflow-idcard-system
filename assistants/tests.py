import io
import pandas as pd
from django.test import TestCase
from core.models import User
from client.models import Client
from assistants.models import Assistant
from assistants.services import AssistantService
from idcards.models import IDCardGroup, IDCardTable, IDCard

class AutoCreateAssistantsTests(TestCase):
    def setUp(self):
        # Create a dummy client
        self.user = User.objects.create(username='test_admin', email='test@test.com')
        self.client_obj = Client.objects.create(name='Test Client Auto Create', user=self.user)

        # Create dummy IDCardGroup, IDCardTable, IDCard
        self.group = IDCardGroup.objects.create(client=self.client_obj, name='Test Group')
        
        self.table = IDCardTable.objects.create(
            group=self.group, 
            name='Test Table',
            fields=[{'name': 'Class', 'type': 'text'}, {'name': 'Section', 'type': 'text'}]
        )

        IDCard.objects.create(table=self.table, field_data={'Class': 'V', 'Section': 'A'})
        IDCard.objects.create(table=self.table, field_data={'Class': 'V', 'Section': 'B'})
        IDCard.objects.create(table=self.table, field_data={'Class': 'VI', 'Section': ''})

    def test_auto_create_class_mode(self):
        result = AssistantService.auto_create_assistants(self.user, self.client_obj, 'STGS', 'class', True)
        self.assertTrue(result.success)
        self.assertEqual(result.data['count'], 2) # Should create for Class V and VI
        
        # Verify Excel buffer is valid
        buffer = result.data['buffer']
        df = pd.read_excel(buffer, engine='openpyxl')
        self.assertEqual(len(df), 2)
        
        # Verify assistants were created
        self.assertEqual(Assistant.objects.filter(client=self.client_obj).count(), 2)

    def test_auto_create_section_mode(self):
        result = AssistantService.auto_create_assistants(self.user, self.client_obj, 'STGS', 'section', True)
        self.assertTrue(result.success)
        self.assertEqual(result.data['count'], 3) # V-A, V-B, and VI
        
        buffer = result.data['buffer']
        df = pd.read_excel(buffer, engine='openpyxl')
        self.assertEqual(len(df), 3)

        self.assertEqual(Assistant.objects.filter(client=self.client_obj).count(), 3)


from django.urls import reverse

class AssistantAPIViewPermissionTests(TestCase):
    def setUp(self):
        # Create users
        self.super_admin = User.objects.create_user(
            username='super_admin@test.com', email='super_admin@test.com', password='adminpass1', role='super_admin'
        )
        self.client_user = User.objects.create_user(
            username='client_user@test.com', email='client_user@test.com', password='clientpass1', role='client'
        )
        self.client_obj = Client.objects.create(name='Test Client Permissions', user=self.client_user)

        self.group = IDCardGroup.objects.create(client=self.client_obj, name='Test Group')
        self.table = IDCardTable.objects.create(
            group=self.group, 
            name='Test Table',
            fields=[{'name': 'Class', 'type': 'text'}, {'name': 'Section', 'type': 'text'}]
        )
        # Create at least one IDCard so auto-create has data to work with
        IDCard.objects.create(table=self.table, field_data={'Class': 'V', 'Section': 'A'})

    def test_auto_create_endpoint_allows_super_admin(self):
        self.client.force_login(self.super_admin)
        response = self.client.post(reverse('assistants:api_staff_auto_create'), {
            'client_id': self.client_obj.id,
            'acronym': 'TST',
            'mode': 'class',
            'assign': 'true',
            'id_source': 'group',
            'group_id': self.group.id
        })
        # Should succeed and return the Excel spreadsheet
        self.assertEqual(response.status_code, 200)

    def test_auto_create_endpoint_denies_client_admin(self):
        self.client.force_login(self.client_user)
        response = self.client.post(reverse('assistants:api_staff_auto_create'), {
            'client_id': self.client_obj.id,
            'acronym': 'TST',
            'mode': 'class',
            'assign': 'true',
            'id_source': 'group',
            'group_id': self.group.id
        })
        self.assertEqual(response.status_code, 403)

    def test_bulk_upload_endpoint_allows_super_admin_pass_gate(self):
        self.client.force_login(self.super_admin)
        response = self.client.post(reverse('assistants:api_staff_bulk_upload_xlsx'), {
            'client_id': self.client_obj.id,
        })
        # If it passed the decorator gate, it will fail on file validation (400) rather than permission (403)
        self.assertEqual(response.status_code, 400)

    def test_bulk_upload_endpoint_denies_client_admin(self):
        self.client.force_login(self.client_user)
        response = self.client.post(reverse('assistants:api_staff_bulk_upload_xlsx'), {
            'client_id': self.client_obj.id,
        })
        self.assertEqual(response.status_code, 403)

