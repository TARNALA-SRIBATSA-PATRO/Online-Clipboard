FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create data directories
RUN mkdir -p data/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV MAX_FILE_SIZE_MB=50

EXPOSE 3000

CMD ["npm", "start"]
