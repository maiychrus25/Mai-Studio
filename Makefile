.PHONY: build test lint
build:
	npm run build
	@echo "Build succeeded"
test:
	npm test
lint:
	npm run lint
