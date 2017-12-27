FROM node:alpine
ENV NODE_ENV=production
WORKDIR /opt/app

COPY package.json yarn.lock ./
RUN yarn install

COPY . .
RUN ./node_modules/.bin/tsc

CMD ["node", "./built/index.js"]

USER node
