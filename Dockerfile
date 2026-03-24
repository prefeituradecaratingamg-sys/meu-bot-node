# ================================
# BASE IMAGE
# ================================
FROM node:18-slim

# ================================
# DEPENDÊNCIAS DO SISTEMA
# Necessárias para o Puppeteer /
# Chromium rodar dentro do Docker
# ================================
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ================================
# VARIÁVEL DO PUPPETEER
# Aponta para o Chromium do sistema
# ao invés de baixar o próprio
# ================================
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ================================
# DIRETÓRIO DE TRABALHO
# ================================
WORKDIR /app

# ================================
# DEPENDÊNCIAS NODE
# Copia package.json antes do resto
# para aproveitar cache do Docker
# ================================
COPY package*.json ./

RUN npm install --omit=dev

# ================================
# CÓDIGO DA APLICAÇÃO
# ================================
COPY . .

# ================================
# PASTA DE SESSÃO DO WHATSAPP
# Persistência da autenticação
# ================================
RUN mkdir -p /app/.wwebjs_auth && chmod 777 /app/.wwebjs_auth

# ================================
# PORTA EXPOSTA
# ================================
EXPOSE 3000

# ================================
# COMANDO DE INICIALIZAÇÃO
# ================================
CMD ["node", "server.js"]
