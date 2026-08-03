.PHONY: setup up down migrate makemigrations test shell worker beat superuser

setup:
	cp .env.example .env
	pip install -r requirements-dev.txt

up:
	docker compose up -d

down:
	docker compose down

migrate:
	docker compose exec django python manage.py migrate

makemigrations:
	docker compose exec django python manage.py makemigrations

test:
	pytest

shell:
	docker compose exec django python manage.py shell

worker:
	celery -A workers.celery_app worker -l info

beat:
	celery -A workers.celery_app beat -l info

superuser:
	docker compose exec django python manage.py createsuperuser\n