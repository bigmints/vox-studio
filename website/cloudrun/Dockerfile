ARG FIKR_BASE_IMAGE
FROM ${FIKR_BASE_IMAGE}
COPY --chown=1001:1001 cloudrun/vox-entry.cjs /app/vox-entry.cjs
COPY --chown=1001:1001 dist/ /app/vox-public/
COPY --chown=1001:1001 main/ /app/fikr-main/
CMD ["node", "/app/vox-entry.cjs"]
