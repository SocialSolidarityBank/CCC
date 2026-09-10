FROM denoland/deno:2.9.6@sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d

WORKDIR /app
COPY --chown=deno:deno dist/index.js with-ca.sh ./
COPY --chown=deno:deno src/application-ca.mjs src/validate-ca.mjs ./src/
USER deno
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["deno", "eval", "try { const r = await fetch('http://127.0.0.1:' + (Deno.env.get('PORT') ?? '8080') + '/readyz'); Deno.exit(r.status === 200 ? 0 : 1); } catch { Deno.exit(1); }"]
ENTRYPOINT ["/tini", "--", "/bin/sh", "/app/with-ca.sh"]
CMD ["deno", "run", "--no-config", "--no-lock", "--no-remote", "--no-prompt", "--allow-env", "--allow-net", "--allow-read", "/app/index.js"]
