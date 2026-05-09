ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY fixtures ./fixtures
COPY README.md agents.md .env.example ./

RUN mkdir -p /app/data/notebooks /app/data/indexes /app/data/logs /app/uploads /app/server/log \
  && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT||3000; fetch('http://127.0.0.1:'+port+'/api/status').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server/index.js"]
