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
