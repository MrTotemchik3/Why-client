FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs visual-relay.mjs world-schema.json ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node","server.mjs"]
