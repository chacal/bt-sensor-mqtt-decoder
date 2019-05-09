ARG BASE="amd64"
FROM $BASE/node:11-slim
ENV NODE_ENV=production
WORKDIR /opt/app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN ./node_modules/.bin/tsc

CMD ["node", "./built/index.js"]

USER node
