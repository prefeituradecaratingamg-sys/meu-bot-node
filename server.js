/**
 * AGENTE DE IA + CHATBOT WHATSAPP — VENDEDOR INTELIGENTE
 * Backend com Express, WhatsApp Web.js, Groq AI e Socket.IO
 * QR Code aparece no navegador - sem terminal!
 * v2.0 — Funil de vendas com memória de contexto e anti-loop
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const OpenAI = require("openai");

// =====================================
// CONFIGURAÇÃO
// =====================================
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, "config.json");

let groqClient = null;
let whatsappClient = null;
let whatsappConectado = false;
let io = null;

// Memória de conversas por número
// Estrutura: { [numero]: { etapa, ultimaResposta, ts, tentativas } }
const memoriaConversas = {};

// Tempo em ms para resetar conversa por inatividade (30 min)
const TEMPO_RESET_CONVERSA = 30 * 60 * 1000;

// =====================================
// ETAPAS DO FUNIL DE VENDAS
// =====================================
const ETAPAS = {
  INICIO: "inicio",
  INTERESSE: "interesse",
  BENEFICIO: "beneficio",
  PRECO: "preco",
  FECHAMENTO: "fechamento",
  POS_FECHAMENTO: "pos_fechamento",
};

// =====================================
// VARIAÇÕES DE RESPOSTAS (anti-robô)
// =====================================
function escolher(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const RESPOSTAS = {
  saudacao: [
    "Fala! 😄 Vi que você veio pelo anúncio...\n\nMe conta uma coisa: você quer usar o WhatsApp pra vender mais ou principalmente pra responder clientes mais rápido?",
    "Oi! 👋 Que bom que você chegou aqui!\n\nMe diz uma coisa rápida: você quer automatizar seu WhatsApp pra vender mais ou quer só deixar o atendimento mais ágil?",
    "Eae! 😊 Vi que você veio pelo anúncio...\n\nRápida pergunta: você prefere usar isso pra vender mais ou pra não perder cliente por demora no atendimento?",
  ],
  interesse_sim: [
    "Perfeito! 🔥 Hoje quem responde rápido sai na frente...\n\nEsse sistema trabalha 24h no seu lugar, responde automático e ainda conduz o cliente até a compra.\n\nQuer entender como funciona ou já quer garantir agora com o desconto de lançamento?",
    "Boa escolha! 💪 Sabia que 70% dos clientes desistem quando demoram pra ser respondidos?\n\nEsse sistema resolve isso — atende 24h, não perde nenhum lead e ainda qualifica pra você.\n\nQuer ver o preço ou prefere entender melhor como funciona?",
    "Show! 🚀 Você já tá na frente então...\n\nMuita gente ainda tá respondendo tudo na mão e perdendo tempo e venda.\n\nEsse sistema automatiza tudo isso. Quer ver uma demonstração rápida ou prefere ir direto pro valor?",
  ],
  beneficio: [
    "Olha, no fundo é simples: você instala uma vez e ele trabalha por você 24h por dia, 7 dias por semana. 💡\n\nResponde dúvidas, qualifica lead, manda preço... tudo automático.\n\nE o melhor: pagamento único, sem mensalidade.\n\nQuer saber o valor?",
    "É assim que funciona: o sistema detecta a mensagem, identifica o que o cliente quer e responde na hora — até de madrugada. 🌙\n\nVocê só entra quando o cliente já tá quente pra fechar.\n\nQuer ver quanto custa?",
    "Simples assim: você para de perder venda por não responder a tempo. ⚡\n\nO sistema assume o atendimento, conduz a conversa e avisa quando o cliente tá pronto pra comprar.\n\nVou te falar o valor?",
  ],
  preco: [
    "🔥 Hoje tá com desconto de lançamento:\n\nDe R$197,90 por apenas *R$25,90*\n\nPagamento único — sem mensalidade, sem surpresa.\n\nFaz sentido pra você?",
    "💰 Olha o preço de lançamento:\n\nDe R$197,90 por *R$25,90 uma vez só*\n\nSem renovação, sem mensalidade. Pagou, é seu pra sempre.\n\nVai garantir?",
    "Aí é onde fica interessante 😄\n\nDe R$197,90 por *R$25,90 pagamento único*\n\nMenos de R$1 por dia pra ter um vendedor trabalhando 24h pra você.\n\nQuer garantir agora?",
  ],
  fechamento: [
    "Ótimo! 🎉 Clica no link abaixo pra garantir agora com desconto:\n\n👉 https://ai-agent-sales-magic.lovable.app/\n\nAssim que confirmar, você já recebe o acesso. Qualquer dúvida é só falar!",
    "Top! Pega o link aqui e garante agora — o desconto é por tempo limitado:\n\n👉 https://ai-agent-sales-magic.lovable.app/\n\nQualquer dúvida antes de fechar, pode perguntar 😄",
    "Perfeito! Segue o link pra garantir com o desconto de lançamento:\n\n👉 https://ai-agent-sales-magic.lovable.app/\n\nLogo que confirmar o pagamento já libero seu acesso! 🚀",
  ],
  imagem: [
    "Vi sua foto aí! 😄 Você chegou pelo anúncio né?\n\nMe fala: você quer usar o WhatsApp pra vender mais ou principalmente pra agilizar o atendimento?",
    "Recebi sua imagem! 📸 Imagino que você veio pelo anúncio...\n\nRápida pergunta: o maior problema hoje é perder cliente por demorar a responder ou é a dificuldade de fechar venda?",
  ],
  audio: [
    "Recebi seu áudio! 🎙️ Me fala aqui em texto rapidinho...\n\nO que você mais precisa agora: responder mais rápido ou vender mais?",
    "Ouvi seu áudio 😄 Pra eu te ajudar melhor, me manda em texto:\n\nVocê quer automatizar pra vender mais ou pra não perder cliente por falta de resposta?",
  ],
  duvida_nome: [
    "Sou um assistente automático 🤖 mas pode confiar, tô aqui pra te ajudar de verdade!\n\nMe fala: você quer vender mais pelo WhatsApp?",
    "Sou um robô treinado pra vendas 😄 Mas não fica com vergonha, conversa comigo normalmente!\n\nVocê quer aumentar suas vendas pelo WhatsApp?",
  ],
  fallback: [
    "Entendi! 😄 Me fala uma coisa então: você quer vender mais ou quer deixar seu atendimento mais rápido?",
    "Boa pergunta! Isso aqui pode te ajudar bastante com vendas no WhatsApp 🔥\n\nQuer entender como funciona ou prefere ir direto pro valor?",
    "Legal você falar isso! 😊 O que você mais precisa hoje: atender mais rápido ou fechar mais vendas?",
  ],
  loop_breaker: [
    "Eita, parece que a gente entrou num loop 😅\n\nVou ser direto: esse sistema pode te ajudar a vender mais no WhatsApp por *R$25,90 pagamento único*.\n\nQuer saber mais ou prefere garantir agora?",
    "Acho que me perdi aqui 😄 Deixa eu ser objetivo:\n\nTenho um sistema de automação de WhatsApp por *R$25,90*.\n\nVai querer ver como funciona?",
  ],
};

// =====================================
// HELPERS DE ESTADO
// =====================================
function getEstado(numero) {
  const agora = Date.now();
  const estado = memoriaConversas[numero];
  if (!estado || agora - estado.ts > TEMPO_RESET_CONVERSA) {
    memoriaConversas[numero] = {
      etapa: ETAPAS.INICIO,
      ultimaResposta: null,
      ts: agora,
      tentativas: 0,
      historico: [],
    };
  } else {
    memoriaConversas[numero].ts = agora;
  }
  return memoriaConversas[numero];
}

function atualizarEstado(numero, updates) {
  const estado = getEstado(numero);
  Object.assign(estado, updates, { ts: Date.now() });
}

function adicionarHistorico(numero, mensagem, resposta) {
  const estado = getEstado(numero);
  estado.historico.push({ mensagem, resposta, ts: Date.now() });
  // Manter apenas últimas 10 interações
  if (estado.historico.length > 10) estado.historico.shift();
}

// =====================================
// DETECÇÃO DE INTENÇÃO
// =====================================
function detectarIntencao(texto) {
  const t = texto.toLowerCase().trim();

  if (/^(sim|s|claro|quero|pode|top|boa|bora|vai|fechou|ok|okay|vamos|vou|aceito|quero sim|pode ser|com certeza)$/.test(t))
    return "confirmacao";

  if (/não|nao|agora não|agora nao|depois|talvez|vou pensar|sem dinheiro|caro|deixa pra|outra hora/.test(t))
    return "objecao";

  if (/valor|preço|preco|quanto|custa|investimento|cobr|mensalidade|pagamento/.test(t))
    return "preco";

  if (/funciona|como é|como e|como funciona|o que|serve|garantia|resultado|realmente/.test(t))
    return "duvida_funciona";

  if (/comprar|compro|garantir|fechar|pagar|link|quero comprar|quero garantir/.test(t))
    return "compra";

  if (/oi|olá|ola|bom dia|boa tarde|boa noite|hey|eae|eai|tudo bem|tudo bom/.test(t))
    return "saudacao";

  if (/vender|venda|vendo|vendas|aumentar|cliente|lead|negocio|negócio/.test(t))
    return "interesse_venda";

  if (/nome|quem é|quem e|você é|voce e|robô|robo|humano|pessoa/.test(t))
    return "identidade";

  if (/obrigado|obrigada|valeu|vlw|grato|grata|muito obrigado/.test(t))
    return "agradecimento";

  return "outro";
}

// =====================================
// LÓGICA CENTRAL DO FUNIL
// =====================================
async function processarMensagem(numero, texto, tipoMidia) {
  const estado = getEstado(numero);
  estado.tentativas = (estado.tentativas || 0) + 1;

  // Anti-loop: muitas tentativas sem avançar
  if (estado.tentativas > 8 && estado.etapa === ETAPAS.INICIO) {
    atualizarEstado(numero, { etapa: ETAPAS.PRECO, tentativas: 0 });
    return escolher(RESPOSTAS.loop_breaker);
  }

  // Tratar mídia
  if (tipoMidia === "imagem") {
    atualizarEstado(numero, { etapa: ETAPAS.INTERESSE });
    return escolher(RESPOSTAS.imagem);
  }

  if (tipoMidia === "audio") {
    return escolher(RESPOSTAS.audio);
  }

  const intencao = detectarIntencao(texto);

  // Intenção de compra direta — pular funil
  if (intencao === "compra") {
    atualizarEstado(numero, { etapa: ETAPAS.POS_FECHAMENTO, tentativas: 0 });
    return escolher(RESPOSTAS.fechamento);
  }

  // Pergunta sobre identidade — qualquer etapa
  if (intencao === "identidade") {
    return escolher(RESPOSTAS.duvida_nome);
  }

  // Agradecimento
  if (intencao === "agradecimento") {
    return "Disponha! 😄 Qualquer dúvida pode falar. E se quiser garantir o sistema: 👉 https://ai-agent-sales-magic.lovable.app/";
  }

  // Lógica por etapa
  switch (estado.etapa) {
    case ETAPAS.INICIO: {
      if (intencao === "saudacao" || intencao === "outro") {
        atualizarEstado(numero, { etapa: ETAPAS.INTERESSE, tentativas: 0 });
        return escolher(RESPOSTAS.saudacao);
      }
      if (intencao === "confirmacao" || intencao === "interesse_venda") {
        atualizarEstado(numero, { etapa: ETAPAS.BENEFICIO, tentativas: 0 });
        return escolher(RESPOSTAS.interesse_sim);
      }
      if (intencao === "preco") {
        atualizarEstado(numero, { etapa: ETAPAS.FECHAMENTO, tentativas: 0 });
        return escolher(RESPOSTAS.preco);
      }
      atualizarEstado(numero, { etapa: ETAPAS.INTERESSE, tentativas: 0 });
      return escolher(RESPOSTAS.saudacao);
    }

    case ETAPAS.INTERESSE: {
      if (intencao === "confirmacao" || intencao === "interesse_venda") {
        atualizarEstado(numero, { etapa: ETAPAS.BENEFICIO, tentativas: 0 });
        return escolher(RESPOSTAS.interesse_sim);
      }
      if (intencao === "duvida_funciona") {
        atualizarEstado(numero, { etapa: ETAPAS.BENEFICIO, tentativas: 0 });
        return escolher(RESPOSTAS.beneficio);
      }
      if (intencao === "preco") {
        atualizarEstado(numero, { etapa: ETAPAS.FECHAMENTO, tentativas: 0 });
        return escolher(RESPOSTAS.preco);
      }
      if (intencao === "objecao") {
        return "Entendo! 😊 Sem pressão. Posso só te perguntar: o que tá te impedindo agora — é o preço, a dúvida se funciona, ou outra coisa?";
      }
      // saudação repetida ou outro
      atualizarEstado(numero, { etapa: ETAPAS.INTERESSE, tentativas: 0 });
      return escolher(RESPOSTAS.interesse_sim);
    }

    case ETAPAS.BENEFICIO: {
      if (intencao === "confirmacao" || intencao === "preco") {
        atualizarEstado(numero, { etapa: ETAPAS.FECHAMENTO, tentativas: 0 });
        return escolher(RESPOSTAS.preco);
      }
      if (intencao === "duvida_funciona") {
        return escolher(RESPOSTAS.beneficio);
      }
      if (intencao === "objecao") {
        return "Entendo a dúvida! 😄 Olha, é só R$25,90 único — menos que um almoço. E você tem o sistema pra sempre. Faz sentido tentar?";
      }
      atualizarEstado(numero, { etapa: ETAPAS.PRECO, tentativas: 0 });
      return escolher(RESPOSTAS.beneficio);
    }

    case ETAPAS.PRECO: {
      if (intencao === "confirmacao") {
        atualizarEstado(numero, { etapa: ETAPAS.FECHAMENTO, tentativas: 0 });
        return escolher(RESPOSTAS.fechamento);
      }
      if (intencao === "objecao") {
        return "Fica tranquilo 😊 Me conta: o que tá pesando — é o valor ou tem alguma dúvida sobre o sistema?";
      }
      if (intencao === "duvida_funciona") {
        atualizarEstado(numero, { etapa: ETAPAS.BENEFICIO, tentativas: 0 });
        return escolher(RESPOSTAS.beneficio);
      }
      atualizarEstado(numero, { etapa: ETAPAS.FECHAMENTO, tentativas: 0 });
      return escolher(RESPOSTAS.preco);
    }

    case ETAPAS.FECHAMENTO:
    case ETAPAS.POS_FECHAMENTO: {
      if (intencao === "confirmacao") {
        atualizarEstado(numero, { etapa: ETAPAS.POS_FECHAMENTO, tentativas: 0 });
        return escolher(RESPOSTAS.fechamento);
      }
      if (intencao === "objecao") {
        return "Entendo! 🤝 Se tiver qualquer dúvida antes de decidir, pode falar à vontade. Tô aqui pra ajudar.";
      }
      if (intencao === "duvida_funciona") {
        atualizarEstado(numero, { etapa: ETAPAS.BENEFICIO, tentativas: 0 });
        return escolher(RESPOSTAS.beneficio);
      }
      if (intencao === "preco") {
        return escolher(RESPOSTAS.preco);
      }
      return "Perfeito! Aqui o link pra garantir com desconto: 👉 https://ai-agent-sales-magic.lovable.app/\n\nQualquer dúvida é só falar 😄";
    }

    default: {
      atualizarEstado(numero, { etapa: ETAPAS.INICIO, tentativas: 0 });
      return escolher(RESPOSTAS.saudacao);
    }
  }
}

// =====================================
// CARREGAR / SALVAR CONFIG
// =====================================
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Erro ao carregar config:", e);
  }
  const defaultConfig = {
    groqApiKey: "",
    useAI: false, // IA como fallback opcional
    model: "llama-3.1-8b-instant",
    promptSistema:
      "Você é um vendedor especialista em WhatsApp. Seja simpático, objetivo e sempre conduza a conversa para a venda do sistema de automação por R$25,90. Nunca encerre sem direcionar o cliente.",
    flows: [],
  };
  saveConfig(defaultConfig);
  return defaultConfig;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

let config = loadConfig();

if (config.groqApiKey && config.groqApiKey.trim()) {
  groqClient = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

// =====================================
// EXPRESS + SOCKET.IO
// =====================================
const app = express();
const server = http.createServer(app);
io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig(config);
  if (config.groqApiKey && config.groqApiKey.trim()) {
    groqClient = new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  const safe = { ...config };
  if (safe.groqApiKey) safe.groqApiKey = safe.groqApiKey.substring(0, 8) + "***";
  res.json(safe);
});

app.get("/api/config/full", (req, res) => {
  res.json(config);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    if (whatsappClient) {
      whatsappConectado = false;
      try { await whatsappClient.destroy(); } catch (e) {}
      whatsappClient = null;
      io.emit("status", { conectado: false, mensagem: "Desconectado. Clique em Gerar novo QR Code para conectar novamente." });
    }
    res.json({ ok: true });
  } catch (e) {
    whatsappClient = null;
    res.json({ ok: true });
  }
});

app.post("/api/whatsapp/restart", async (req, res) => {
  try {
    if (whatsappClient) {
      try { await whatsappClient.destroy(); } catch (e) {}
      whatsappClient = null;
    }
    whatsappConectado = false;

    if (req.query.limpar === "1") {
      const authPath = path.join(__dirname, ".wwebjs_auth");
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true });
          console.log("Sessão limpa. Iniciando do zero.");
        } catch (e) {
          console.error("Erro ao limpar sessão:", e);
        }
      }
    }

    io.emit("qr", "loading");
    io.emit("status", { conectado: false, mensagem: "Gerando QR Code... Pode levar 1-2 minutos na primeira vez." });
    initWhatsApp(true);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao reiniciar:", e);
    io.emit("status", { conectado: false, mensagem: "Erro. Clique em 'Limpar sessão e tentar' para recomeçar." });
    res.json({ ok: false, erro: e.message });
  }
});

// =====================================
// WHATSAPP
// =====================================
function initWhatsApp(force = false) {
  if (whatsappClient && !force) return;
  if (whatsappClient && force) whatsappClient = null;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ clientId: "agente-ia" }),
    authTimeoutMs: 180000,
    puppeteer: {
      headless: true,
      timeout: 120000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--no-first-run",
      ],
    },
  });

  whatsappClient.on("qr", async (qr) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
      io.emit("qr", qrDataUrl);
      io.emit("status", { conectado: false, mensagem: "Escaneie o QR Code com seu WhatsApp" });
    } catch (e) {
      console.error("Erro ao gerar QR:", e);
    }
  });

  whatsappClient.on("ready", () => {
    whatsappConectado = true;
    io.emit("qr", null);
    io.emit("status", { conectado: true, mensagem: "WhatsApp conectado!" });
    console.log("✅ WhatsApp conectado.");
  });

  whatsappClient.on("disconnected", () => {
    whatsappConectado = false;
    io.emit("status", { conectado: false, mensagem: "WhatsApp desconectado" });
  });

  whatsappClient.on("auth_failure", (msg) => {
    console.error("Falha na autenticação:", msg);
    io.emit("status", { conectado: false, mensagem: "Falha ao conectar. Clique em 'Limpar sessão e tentar'." });
  });

  whatsappClient.on("message", handleMessage);

  whatsappClient.initialize().catch((err) => {
    console.error("Erro ao inicializar WhatsApp:", err);
    whatsappClient = null;
    io.emit("status", { conectado: false, mensagem: "Erro ao iniciar. Feche outros programas e clique em 'Limpar sessão e tentar'." });
  });
}

// =====================================
// HANDLER DE MENSAGENS
// =====================================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function respostaPorIA(texto, contextoHistorico = []) {
  if (!groqClient || !config.groqApiKey) return null;
  try {
    const messages = [
      { role: "system", content: config.promptSistema || "Você é um vendedor prestativo." },
      ...contextoHistorico.slice(-4).flatMap((h) => [
        { role: "user", content: h.mensagem },
        { role: "assistant", content: h.resposta },
      ]),
      { role: "user", content: texto },
    ];

    const completion = await groqClient.chat.completions.create({
      model: config.model || "llama-3.1-8b-instant",
      messages,
      max_tokens: 300,
      temperature: 0.75,
    });
    const res = completion.choices?.[0]?.message?.content;
    return res ? res.trim() : null;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    return null;
  }
}

async function handleMessage(msg) {
  try {
    // Ignorar grupos e mensagens próprias
    if (!msg.from || msg.from.endsWith("@g.us")) return;
    const chat = await msg.getChat();
    if (chat.isGroup || msg.fromMe) return;

    const numero = msg.from;

    // Detectar tipo de mídia
    let tipoMidia = null;
    if (msg.hasMedia || ["image", "video", "ptt", "audio"].includes(msg.type)) {
      if (msg.type === "audio" || msg.type === "ptt") tipoMidia = "audio";
      else if (msg.type === "image") tipoMidia = "imagem";
      else tipoMidia = "video";
    }

    const textoOriginal = (msg.body || "").trim();
    const texto = textoOriginal.toLowerCase();

    // Simular digitação humana
    await delay(600 + Math.random() * 600);
    await chat.sendStateTyping();
    await delay(800 + Math.random() * 700);

    // Obter estado atual
    const estado = getEstado(numero);

    // Processar pelo funil
    let resposta = await processarMensagem(numero, texto, tipoMidia);

    // Fallback para IA se configurado e funil retornou fallback
    if (!resposta && config.useAI) {
      resposta = await respostaPorIA(textoOriginal, estado.historico);
    }

    // Fallback final
    if (!resposta) {
      resposta = escolher(RESPOSTAS.fallback);
    }

    // Evitar resposta duplicada consecutiva
    if (estado.ultimaResposta && estado.ultimaResposta === resposta) {
      resposta = escolher(RESPOSTAS.fallback);
    }

    // Salvar no histórico e atualizar estado
    adicionarHistorico(numero, textoOriginal, resposta);
    atualizarEstado(numero, { ultimaResposta: resposta });

    await msg.reply(resposta);

  } catch (error) {
    console.error("❌ Erro no handleMessage:", error);
  }
}

// =====================================
// INICIAR SERVIDOR
// =====================================
app.get("/", (req, res) => {
  res.send("Bot WhatsApp rodando 🚀");
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});


