const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// Servidor para ver el QR
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center><h1>ONE4CARS - Escanea el QR</h1><img src="${qrCodeData}" width="350"></center>`);
    } else {
        res.write(`<center><h1>${qrCodeData || "Iniciando... espera 30 segundos."}</h1></center>`);
    }
    res.end();
}).listen(process.env.PORT || 8080);

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
    console.log("QR generado");
});

client.on('ready', () => {
    qrCodeData = "¡BOT ONLINE! ✅";
    console.log("Conectado");
});

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido")) return;
    const t = msg.body.toLowerCase();
    if (t.includes('hola') || t.includes('buen')) {
        await client.sendMessage(msg.from, 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe la opción:\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n👤 *Asesor*');
    }
    if (t.includes('pago')) await client.sendMessage(msg.from, '🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-1234567');
});

client.initialize();
