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
        // ... el resto de tus argumentos (no-sandbox, etc)
    }
});

const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write('<div style="text-align:center;"><h1>Escanea el QR de ONE4CARS</h1><img src="' + qrCodeData + '" style="width:300px;"></div>');
    } else {
        res.write('<div style="text-align:center;"><h1>' + (qrCodeData || "Iniciando sistema... refresca en 1 min.") + '</h1></div>');
    }
    res.end();
}).listen(port, '0.0.0.0');

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "BOT CONECTADO ✅"; console.log('Online'); });

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;
    const t = msg.body.toLowerCase();
    const saludos = ['hola', 'buen dia', 'buen día', 'buendia', 'buenos dias', 'buenos días', 'saludos'];

    if (saludos.some(s => t === s || t.includes(s)) && !t.includes('pago') && !t.includes('precio')) {
        return msg.reply('Hola! Bienvenido a *ONE4CARS* 🚗. Escribe la frase de tu opción:\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*');
    }
    
    if (t.includes('medios de pago')) return msg.reply('🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-0000000');
    if (t.includes('lista de precios')) return msg.reply('💰 *PRECIOS*\nDescarga aquí: [LINK]');
    if (t.includes('estado de cuenta')) return msg.reply('📄 *CUENTA*\nIndique RIF o Nombre de empresa.');
    if (t.includes('tomar pedido')) return msg.reply('🛒 *PEDIDO*\nIndique código y cantidad.');
    if (t.includes('despacho')) return msg.reply('🚚 *DESPACHO*\nIndique número de factura.');
    if (t.includes('asesor')) return msg.reply('👤 *ASESOR*\nUn humano te atenderá pronto.');
});

client.initialize();
