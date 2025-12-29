const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        // HEMOS QUITADO executablePath para evitar el error ENOENT
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote'
        ]
    }
});

// Servidor para Render
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write('<div style="text-align:center;font-family:Arial;"><h1>Escanea ONE4CARS</h1><img src="' + qrCodeData + '" style="width:300px;"></div>');
    } else {
        res.write('<div style="text-align:center;font-family:Arial;"><h1>' + (qrCodeData || "Iniciando sistema... refresca en 1 min.") + '</h1></div>');
    }
    res.end();
}).listen(port, '0.0.0.0');

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "BOT ONLINE ✅"; console.log('Bot conectado'); });

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;
    const t = msg.body.toLowerCase().trim();
    const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];

    if (saludos.some(s => t === s || t.includes(s)) && !t.includes('pago')) {
        return msg.reply(
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Escribe la frase de la opción que necesitas:\n\n' +
            '📲 *Menú de Gestión Comercial*\n' +
            '🏦 *Medios de Pago*\n' +
            '📄 *Estado de Cuenta*\n' +
            '💰 *Lista de Precios*\n' +
            '🛒 *Tomar Pedido*\n' +
            '👥 *Mis Clientes*\n' +
            '⚙️ *Ficha Producto*\n' +
            '🚚 *Despacho*\n' +
            '👤 *Asesor*'
        );
    }
    if (t.includes('pago')) return msg.reply('🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, RIF J-12345678, Tel: 0412-1234567');
    if (t.includes('asesor')) return msg.reply('👤 *ASESOR*\n\nHe notificado a un humano. Espera un momento...');
});

client.initialize();
