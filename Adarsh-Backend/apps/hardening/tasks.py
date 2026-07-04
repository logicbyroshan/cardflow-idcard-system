from celery import shared_task

@shared_task(name='hardening.ping')
def health_ping_task():
    """
    A simple task used by CeleryHealthService to verify task execution
    and result retrieval.
    """
    return "pong"
