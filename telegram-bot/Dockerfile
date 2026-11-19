FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY dist/ ./dist/
CMD ["node", "dist/telegram-bot.mjs"]
