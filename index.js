const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Servidor mínimo para Render y Cron-Job
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<div style="text-align:center;font-family:Arial;"><h1>ONE4CARS - Escanea el QR</h1><img src="${qrCodeData}" style="width:300px;"></div>`);
    } else {
        res.write(`<div style="text-align:center;font-family:Arial;"><h1>${qrCodeData || "Iniciando sistema... Refresca en un minuto."}</h1></div>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "BOT ONLINE ✅"; console.log('Bot conectado'); });

// LÓGICA DE RESPUESTA (ONE4CARS)
client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const t = msg.body.toLowerCase().trim();
    const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];

    if (saludos.some(s => t === s || t.includes(s)) && !t.includes('pago') && !t.includes('precio')) {
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

    if (t.includes('medios de pago')) return msg.reply('🏦 *MEDIOS DE PAGO*\n\n🔹 *Zelle:* pagos@one4cars.com\n🔹 *Pago Móvil:* Banesco, RIF J-12345678, Tel: 0412-1234567');
    if (t.includes('estado de cuenta')) return msg.reply('📄 *ESTADO DE CUENTA*\n\nIndique su RIF o Nombre de empresa para generar su reporte.');
    if (t.includes('lista de precios')) return msg.reply('💰 *LISTA DE PRECIOS*\n\nDescargue aquí: [TU_LINK]');
    if (t.includes('tomar pedido')) return msg.reply('🛒 *TOMAR PEDIDO*\n\nIndique Código de producto y Cantidad.');
    if (t.includes('asesor')) return msg.reply('👤 *ASESOR*\n\nUn humano te atenderá pronto.');
});

client.initialize();
