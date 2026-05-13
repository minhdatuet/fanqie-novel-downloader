FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package*.json apps/backend/
COPY apps/frontend/package*.json apps/frontend/
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/backend/package*.json apps/backend/
RUN npm install --omit=dev -w apps/backend
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/frontend/dist apps/frontend/dist
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "apps/backend"]
