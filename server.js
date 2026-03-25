const express = require("express")
const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")

const app = express()
const PORT = process.env.PORT || 3000

app.get("/", (req, res) => {
  res.send("BOT ONLINE")
})

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT)
})

const client = new Client({
  authStrategy: new LocalAuth()
})

client.on("qr", (qr) => {
  console.log("Escaneie o QR Code:")
  qrcode.generate(qr, { small: true })
})

client.on("ready", () => {
  console.log("WhatsApp conectado!")
})

client.on("message", msg => {

  if (msg.body.toLowerCase() === "oi") {
    msg.reply("Olá! Como posso ajudar?")
  }

})

client.initialize()
