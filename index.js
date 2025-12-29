const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        executablePath: '/usr/bin/google-chrome', // Usamos el Chrome del sistema de Render
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote'
        ]
    }
});

const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(qrCodeData.includes("data:image") 
        ? `<center><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}"></center>`
        : `<center><h1>${qrCodeData || "Iniciando sistema... refresca en 1 min."}</h1></center>`);
    res.end();
}).listen(port, '0.0.0.0');

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "BOT ONLINE ✅"; console.log('Bot conectado'); });

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;
    const t = msg.body.toLowerCase().trim();
    if (t.includes('hola') || t.includes('buen')) {
        return msg.reply('Hola! Bienvenido a *ONE4CARS* 🚗. Escribe:\n🏦 *Medios de Pago*\n💰 *Lista de Precios*\n📄 *Estado de Cuenta*\n👤 *Asesor*');
    }
    if (t.includes('pago')) return msg.reply('🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-0000000');
    if (t.includes('precio')) return msg.reply('💰 *PRECIOS*\nLink: [TU_LINK]');
});

client.initialize();
