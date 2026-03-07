"""
Email Sender Service
====================
Abstraction layer for sending emails.

Current implementation: **mock** — logs the send and returns success.
Environment variable ``EMAIL_PROVIDER`` controls behaviour:
  - "mock"  → MockEmailSender  (default, current)
  - "brevo" → (future) BrevoEmailSender via Brevo/Sendinblue SMTP
  - "mailgun" → (future) MailgunEmailSender via Mailgun API

FUTURE INTEGRATION POINTS
--------------------------
* **Brevo SMTP for sending**
    Replace ``MockEmailSender.send()`` with an SMTP call using
    ``smtplib`` or ``django.core.mail`` backed by Brevo credentials:
      SMTP_HOST = smtp-relay.brevo.com
      SMTP_PORT = 587
      SMTP_USER = <Brevo login>
      SMTP_PASS = <Brevo API key>

* **Mailgun API for sending**
    POST https://api.mailgun.net/v3/{domain}/messages
    with API key authentication.
"""
import logging
from django.conf import settings
from django.utils import timezone

from ..models import Message

logger = logging.getLogger(__name__)


class MockEmailSender:
    """Simulates email sending by logging the action."""

    def send(self, *, from_email, to_email, subject, body, sender_user=None):
        """
        Simulate sending an email.

        Returns the created Message instance.
        """
        logger.info(
            'Simulated sending email to: %s | from: %s | subject: "%s"',
            to_email, from_email, subject,
        )

        msg = Message.objects.create(
            sender=sender_user,
            from_email=from_email,
            to_email=to_email,
            subject=subject,
            body=body,
            direction='outgoing',
            status='sent',
        )
        logger.info('Email stored — id=%s uuid=%s direction=outgoing status=sent', msg.id, msg.uuid)
        return msg


class InboundEmailHandler:
    """Handles incoming emails (from webhooks or simulation).

    FUTURE INTEGRATION
    ------------------
    * **Mailgun inbound webhook**
        Mailgun POSTs multipart/form-data with fields: sender, recipient,
        subject, body-plain, body-html, etc.  Parse those fields and pass
        to ``receive()`` below.
    """

    def receive(self, *, from_email, to_email, subject, body, recipient_user=None):
        """
        Store an inbound email in the database.

        Returns the created Message instance.
        """
        logger.info(
            'Received inbound email from: %s | to: %s | subject: "%s"',
            from_email, to_email, subject,
        )

        msg = Message.objects.create(
            recipient=recipient_user,
            from_email=from_email,
            to_email=to_email,
            subject=subject,
            body=body,
            direction='incoming',
            status='received',
        )
        logger.info('Email stored — id=%s uuid=%s direction=incoming status=received', msg.id, msg.uuid)
        return msg


def get_email_sender():
    """
    Factory — returns the appropriate sender based on EMAIL_PROVIDER setting.

    Currently only 'mock' is implemented.
    """
    provider = getattr(settings, 'EMAIL_PROVIDER', 'mock')
    if provider == 'mock':
        return MockEmailSender()
    # FUTURE: elif provider == 'brevo': return BrevoEmailSender()
    # FUTURE: elif provider == 'mailgun': return MailgunEmailSender()
    else:
        logger.warning('Unknown EMAIL_PROVIDER "%s", falling back to mock', provider)
        return MockEmailSender()


def get_inbound_handler():
    """Factory — returns the inbound email handler."""
    return InboundEmailHandler()
