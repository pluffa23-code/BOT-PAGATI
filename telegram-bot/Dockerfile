FROM node:24-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY dist/telegram-bot.mjs ./dist/telegram-bot.mjs

CMD ["node", "dist/telegram-bot.mjs"]
