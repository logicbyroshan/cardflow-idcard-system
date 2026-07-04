from rest_framework.test import APITestCase

class BaseAPITestCase(APITestCase):
    def setUp(self):
        super().setUp()
        # Common setup for all tests\n