FROM node:22-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci

COPY frontend/ ./

ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
