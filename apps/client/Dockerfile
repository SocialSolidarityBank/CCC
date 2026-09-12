# Prebuild VERIFIED dist from the repository root (PUBLIC verification keys only):
# pnpm --filter @ccc/client run build:release -- --config /absolute/public-release-config.json
# Build context is apps/client, not the repository root:
# docker build -f apps/client/Dockerfile -t ccc-client:local apps/client
# No signer, Vite build, provider credentials or private keys belong in this image.
FROM denoland/deno:2.9.6@sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d

WORKDIR /app
# Root-owned release bytes stay read-only to the unprivileged server.
COPY dist/ ./dist/
COPY tools/serve-release.mjs ./tools/serve-release.mjs
USER deno
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/tini", "--"]
CMD ["deno", "run", "--no-config", "--no-lock", "--no-remote", "--no-prompt", "--allow-env=PORT", "--allow-net=0.0.0.0", "--allow-read=/app/dist", "/app/tools/serve-release.mjs"]
