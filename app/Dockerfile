FROM node:20-alpine

WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm install

# Copia o código fonte
COPY tsconfig.json ./
COPY src ./src

EXPOSE 3400

# Executa em modo desenvolvimento com hot-reload (tsx watch)
CMD ["npm", "run", "dev"]
