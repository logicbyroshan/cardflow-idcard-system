"""
Seed the adarshmail Message table with sample emails for development.
Usage: python manage.py seed_mail
"""
import uuid
from django.core.management.base import BaseCommand
from adarshmail.models import Message


SAMPLE_EMAILS = [
    {
        "from_email": "orders@amazon.in",
        "to_email": "admin@adarsh.school",
        "subject": "Your order has been shipped!",
        "body": (
            "Hi,\n\n"
            "Your order #402-9381726-4829103 has been shipped and is on its way.\n\n"
            "Estimated delivery: 3-5 business days.\n\n"
            "Track your package at: https://example.com/track/123456\n\n"
            "Thank you for shopping with us!\n"
            "Amazon Team"
        ),
        "direction": "incoming",
        "status": "received",
    },
    {
        "from_email": "noreply@github.com",
        "to_email": "admin@adarsh.school",
        "subject": "New pull request on adarsh-admin",
        "body": (
            "Hi there,\n\n"
            "A new pull request has been opened on your repository adarsh-admin:\n\n"
            "PR #42: Refactor mail service layer\n"
            "Author: dependabot[bot]\n"
            "Branch: feature/mail-refactor -> main\n\n"
            "Review it at: https://github.com/adarsh/admin/pull/42\n\n"
            "— GitHub"
        ),
        "direction": "incoming",
        "status": "received",
    },
    {
        "from_email": "friend@gmail.com",
        "to_email": "admin@adarsh.school",
        "subject": "Weekend plan 🎉",
        "body": (
            "Hey!\n\n"
            "Are you free this Saturday? Thinking of heading to the new café "
            "downtown and then catching a movie.\n\n"
            "Let me know!\n\n"
            "Cheers"
        ),
        "direction": "incoming",
        "status": "received",
    },
    {
        "from_email": "admin@adarsh.school",
        "to_email": "principal@adarsh.school",
        "subject": "Monthly attendance report",
        "body": (
            "Dear Principal,\n\n"
            "Please find attached the monthly attendance report for April 2025.\n\n"
            "Summary:\n"
            "- Total students: 1,240\n"
            "- Average attendance: 94.2%\n"
            "- Classes with <90%: 3\n\n"
            "Regards,\n"
            "Admin Team"
        ),
        "direction": "outgoing",
        "status": "sent",
    },
    {
        "from_email": "admin@adarsh.school",
        "to_email": "support@example.com",
        "subject": "Software license renewal",
        "body": (
            "Hi Support,\n\n"
            "We would like to renew our software license (Order ID: LIC-2024-889).\n"
            "Please send us the renewal quote for 50 seats.\n\n"
            "Thanks,\n"
            "Adarsh Admin"
        ),
        "direction": "outgoing",
        "status": "sent",
    },
]


class Command(BaseCommand):
    help = "Seed the adarshmail Message table with sample development emails"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete ALL existing messages before seeding",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            count = Message.objects.count()
            Message.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Deleted {count} existing message(s)."))

        created = 0
        for data in SAMPLE_EMAILS:
            Message.objects.create(
                uuid=uuid.uuid4(),
                from_email=data["from_email"],
                to_email=data["to_email"],
                subject=data["subject"],
                body=data["body"],
                direction=data["direction"],
                status=data["status"],
            )
            created += 1

        self.stdout.write(self.style.SUCCESS(f"Seeded {created} sample email(s)."))
