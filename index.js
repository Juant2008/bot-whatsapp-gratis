const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

// Configuración ultra-ligera de Puppeteer para Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Servidor para que Render no dé error de puerto
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.startsWith("data:image")) {
        res.write(`<div style="text-align:center;"><h1>Escanea el QR de ONE4CARS</h1><img src="${qrCodeData}" style="width:300px;"></div>`);
    } else {
        res.write(`<div style="text-align:center;"><h1>${qrCodeData || "Iniciando sistema... refresca en breve."}</h1></div>`);
    }
    res.end();
}).listen(process.env.PORT || 3000);

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
    });
});

client.on('ready', () => {
    qrCodeData = "¡Bot de ONE4CARS conectado! ✅";
    console.log('Bot conectado');
});

// Lógica de mensajes
client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const mensajeUsuario = msg.body.toLowerCase().trim();
    const saludos = ['hola', 'buen dia', 'buen día', 'buendia', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'bns dias'];

    if (saludos.some(s => mensajeUsuario.includes(s))) {
        await client.sendMessage(msg.from, 
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Escribe la *frase* de la opción que necesitas:\n\n' +
            '🏦 *Medios de Pago*\n' +
            '📄 *Estado de Cuenta*\n' +
            '💰 *Lista de Precios*\n' +
            '🛒 *Tomar Pedido*\n' +
            '👥 *Mis Clientes*\n' +
            '⚙️ *Ficha Producto*\n' +
            '🚚 *Despacho*'
        );
    } 
    else if (mensajeUsuario.includes('medios de pago')) {
        await client.sendMessage(msg.from, '🏦 *MEDIOS DE PAGO*\n\n🔸 *Zelle:* pagos@one4cars.com\n🔸 *Pago Móvil:* Banesco, RIF J-12345678, Tel: 0412-1234567');
    }
    else if (mensajeUsuario.includes('estado de cuenta')) {
        await client.sendMessage(msg.from, '📄 *ESTADO DE CUENTA*\n\nPor favor, indique su RIF o Nombre de empresa para generar el reporte.');
    }
    else if (mensajeUsuario.includes('lista de precios')) {
        await client.sendMessage(msg.from, '💰 *LISTA DE PRECIOS*\n\nDescárgala aquí: [TU ENLACE]');
    }
    else if (mensajeUsuario.includes('tomar pedido')) {
        await client.sendMessage(msg.from, '🛒 *PEDIDOS*\n\nIndique Código de producto y Cantidad.');
    }
    else if (mensajeUsuario.includes('mis clientes')) {
        await client.sendMessage(msg.from, '👥 *CLIENTES*\n\nExclusivo asesores. Ingrese su código.');
    }
    else if (mensajeUsuario.includes('ficha producto')) {
        await client.sendMessage(msg.from, '⚙️ *FICHA TÉCNICA*\n\nIndique el producto que desea consultar.');
    }
    else if (mensajeUsuario.includes('despacho')) {
        await client.sendMessage(msg.from, '🚚 *DESPACHO*\n\nIndique su número de factura.');
    }
});

client.initialize();
