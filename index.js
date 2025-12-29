const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote'
        ]
    }
});

// Servidor web ligero para el QR y mantenerlo despierto
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(qrCodeData.includes("data:image") 
        ? `<center><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}"></center>`
        : `<center><h1>BOT ACTIVO ✅</h1></center>`);
    res.end();
}).listen(process.env.PORT || 10000);

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "CONECTADO"; console.log('Bot Online'); });

// LÓGICA DE RESPUESTA RÁPIDA
client.on('message', async (msg) => {
    const txt = msg.body.toLowerCase();
    
    // Filtro de saludos ultra rápido
    if (txt.includes('hola') || txt.includes('buen') || txt.includes('dias') || txt.includes('tardes')) {
        return msg.reply('🚗 *ONE4CARS* asistente listo.\n\nEscribe la opción:\n💰 *Lista de Precios*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n🛒 *Tomar Pedido*\n🚚 *Despacho*');
    }

    // Respuestas directas
    if (txt.includes('pago')) {
        return msg.reply('🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-0000000');
    }
    
    if (txt.includes('precio')) {
        return msg.reply('💰 *PRECIOS*\nDescarga aquí: [LINK]');
    }

    if (txt.includes('cuenta')) {
        return msg.reply('📄 *CUENTA*\nEnvía tu RIF o Nombre de empresa.');
    }

    if (txt.includes('pedido')) {
        return msg.reply('🛒 *PEDIDO*\nIndica código y cantidad.');
    }

    if (txt.includes('despacho')) {
        return msg.reply('🚚 *DESPACHO*\nIndica número de factura.');
    }
});

client.initialize();
