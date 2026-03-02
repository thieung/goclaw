VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  = -s -w -X github.com/nextlevelbuilder/goclaw/cmd.Version=$(VERSION)
BINARY   = goclaw

.PHONY: build run clean version up down logs

build:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o $(BINARY) .

run: build
	./$(BINARY)

clean:
	rm -f $(BINARY)

version:
	@echo $(VERSION)

COMPOSE = docker compose -f docker-compose.yml -f docker-compose.managed.yml -f docker-compose.selfservice.yml

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f goclaw

# --- Local dev helpers (not upstream) ---

.PHONY: up-standalone up-otel up-sandbox down-all restart rebuild rebuild-ui logs-ui logs-all ps db-shell migrate-up migrate-down

up-standalone:
	docker compose -f docker-compose.yml -f docker-compose.standalone.yml up -d --build

up-otel:
	$(COMPOSE) -f docker-compose.otel.yml up -d --build

up-sandbox:
	$(COMPOSE) -f docker-compose.sandbox.yml up -d --build

down-all:
	$(COMPOSE) -f docker-compose.otel.yml -f docker-compose.sandbox.yml down

restart:
	$(COMPOSE) restart goclaw

rebuild:
	$(COMPOSE) up -d --build --no-deps goclaw

rebuild-ui:
	$(COMPOSE) up -d --build --no-deps goclaw-ui

logs-ui:
	$(COMPOSE) logs -f goclaw-ui

logs-all:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

db-shell:
	$(COMPOSE) exec postgres psql -U goclaw -d goclaw

migrate-up:
	./$(BINARY) migrate up

migrate-down:
	./$(BINARY) migrate down 1
