.PHONY: build dev start typecheck docker-build docker-run docker-test dev-up dev-down dev-logs dev-rebuild clean

## build — compile TypeScript to dist/
build:
	npx tsc

## dev — run server in watch mode with tsx
dev:
	npx tsx watch src/server.ts

## start — run compiled server
start:
	node dist/server.js

## typecheck — type-check without emitting files
typecheck:
	npx tsc --noEmit

## docker-build — build the Docker image tagged cli2agent
docker-build:
	docker build -t cli2agent .

## docker-run — start via docker compose
docker-run:
	docker compose up

## docker-test — run Docker integration tests (requires ANTHROPIC_API_KEY)
docker-test:
	bash scripts/test-docker.sh

## dev-up — start dev container with live reload
dev-up:
	docker compose --profile dev up cli2agent-dev

## dev-down — stop dev container and remove anonymous volumes
dev-down:
	docker compose --profile dev down -v

## dev-logs — tail dev container logs
dev-logs:
	docker compose --profile dev logs -f cli2agent-dev

## dev-rebuild — rebuild dev image and restart (use after package.json changes)
dev-rebuild:
	docker compose --profile dev up --build cli2agent-dev

## clean — remove compiled output
clean:
	rm -rf dist
