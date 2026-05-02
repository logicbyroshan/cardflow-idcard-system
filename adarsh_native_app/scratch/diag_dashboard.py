import os
import sys
import django

sys.path.append(os.getcwd())

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from mobile_app.views import _client_ctx
from idcards.models import IDCardTable, IDCard
from django.db.models import Count, Q

User = get_user_model()
user = User.objects.filter(role='client').first()
if not user:
    print("No client user found")
else:
    print(f"Testing for user: {user.username} (role: {user.role})")
    try:
        from mobile_app.views import api_dashboard_data
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.get('/app/api/dashboard/')
        request.user = user
        
        # Test _client_ctx
        client, perms = _client_ctx(user)
        print(f"Client: {client}")
        
        # Test dashboard logic manually
        tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True, deleted_by_client=False)
        scoped_table_ids = list(tables_qs.values_list('id', flat=True))
        print(f"Scoped tables: {len(scoped_table_ids)}")
        
        cards_qs = IDCard.objects.filter(table_id__in=scoped_table_ids)
        counts = {}
        for row in cards_qs.values('status').annotate(n=Count('id')):
            print(f"Status {row['status']}: {row['n']}")
            counts[row['status']] = row['n']
            
        tables_annotated = tables_qs.annotate(
            cnt_p=Count('id_cards', filter=Q(id_cards__status='pending')),
            cnt_v=Count('id_cards', filter=Q(id_cards__status='verified')),
            cnt_a=Count('id_cards', filter=Q(id_cards__status='approved')),
            cnt_d=Count('id_cards', filter=Q(id_cards__status='download')),
            cnt_po=Count('id_cards', filter=Q(id_cards__status='pool')),
        )
        print(f"Annotated tables: {tables_annotated.count()}")
        
        print("Diagnostic finished successfully")
    except Exception as e:
        import traceback
        print(f"CRASH: {e}")
        traceback.print_exc()
