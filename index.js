const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
    }
});

// Servidor para Render
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

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
});

client.on('ready', () => {
    qrCodeData = "¡Bot de ONE4CARS conectado correctamente! ✅";
    console.log('Bot listo');
});

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const texto = msg.body.toLowerCase().trim();
    
    // Lista simplificada que cubre todas tus opciones (buen dia, buenos dias, hola, etc.)
    const esSaludo = texto.includes('hola') || texto.includes('buen') || texto.includes('bns') || texto.includes('saludos');

    if (esSaludo && !texto.includes('medios') && !texto.includes('precio')) {
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
    else if (texto.includes('pago') || texto.includes('zelle')) {
        await client.sendMessage(msg.from, '🏦 *MEDIOS DE PAGO*\n\n🔸 *Zelle:* pagos@one4cars.com\n🔸 *Pago Móvil:* Banesco, J-12345678, 0412-0000000');
    }
    else if (texto.includes('cuenta')) {
        await client.sendMessage(msg.from, '📄 *ESTADO DE CUENTA*\n\nIndique su RIF o Nombre de empresa.');
    }
    else if (texto.includes('precio')) {
        await client.sendMessage(msg.from, '💰 *LISTA DE PRECIOS*\n\nAcceda aquí: [TU_LINK]');
    }
    else if (texto.includes('pedido')) {
        await client.sendMessage(msg.from, '🛒 *TOMAR PEDIDO*\n\nIndique código y cantidad.');
    }
    else if (texto.includes('clientes')) {
        await client.sendMessage(msg.from, '👥 *MIS CLIENTES*\n\nIngrese su código de asesor.');
    }
    else if (texto.includes('producto') || texto.includes('ficha')) {
        await client.sendMessage(msg.from, '⚙️ *FICHA PRODUCTO*\n\nIndique el repuesto a consultar.');
    }
    else if (texto.includes('despacho')) {
        await client.sendMessage(msg.from, '🚚 *DESPACHO*\n\nIndique su número de factura.');
    }
});

client.initialize();
