import sys
from django.core.management.base import BaseCommand
from client.models import Client
from staff.models import Staff

class Command(BaseCommand):
    help = 'Interactive command to reset passwords of all client_staff for a specific client to their mobile number.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('--- Client Staff Password Reset Tool ---'))
        
        # 1. List all clients
        clients = list(Client.objects.all().order_by('name'))
        if not clients:
            self.stdout.write(self.style.ERROR('No clients found in the system.'))
            return
            
        for i, client in enumerate(clients, 1):
            staff_count = Staff.objects.filter(client=client, staff_type='client_staff').count()
            self.stdout.write(f"{i}. {client.name} (ID: {client.id}) - {staff_count} assistants")
            
        # 2. Get user input
        self.stdout.write("\n")
        selection = input('Enter the number corresponding to the client (or q to quit): ').strip()
        
        if selection.lower() == 'q':
            self.stdout.write('Operation cancelled.')
            return
            
        try:
            index = int(selection) - 1
            if index < 0 or index >= len(clients):
                self.stdout.write(self.style.ERROR('Invalid selection. Must be within the range.'))
                return
        except ValueError:
            self.stdout.write(self.style.ERROR('Invalid input. Please enter a number.'))
            return
            
        selected_client = clients[index]
        self.stdout.write(self.style.WARNING(f"\nYou selected: {selected_client.name}"))
        
        # 3. Find client staff and reset
        assistants = Staff.objects.filter(client=selected_client, staff_type='client_staff').select_related('user')
        
        if not assistants.exists():
            self.stdout.write(self.style.ERROR(f"No assistants found for client: {selected_client.name}"))
            return
            
        self.stdout.write(f"Found {assistants.count()} assistants. Proceeding to reset passwords to their phone number...")
        
        confirm = input(f"Are you sure you want to reset passwords for {assistants.count()} assistants? (y/n): ").strip().lower()
        if confirm != 'y':
            self.stdout.write('Operation cancelled.')
            return
            
        success_count = 0
        skip_count = 0
        
        for staff in assistants:
            user = staff.user
            phone = user.phone
            
            if not phone:
                self.stdout.write(self.style.WARNING(f"Skipping {user.username} - No phone number found!"))
                skip_count += 1
                continue
                
            user.set_password(phone)
            user.save(update_fields=['password'])
            success_count += 1
            self.stdout.write(self.style.SUCCESS(f"Reset password for {user.username} to {phone}"))
            
        self.stdout.write(self.style.SUCCESS(f"\nFinished! Reset {success_count} passwords. Skipped {skip_count}."))
