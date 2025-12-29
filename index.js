const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

// Configuración de cliente optimizada para la poca RAM de Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
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

// Servidor Web para ver el QR
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<div style="text-align:center;"><h1>Escanea el QR</h1><img src="${qrCodeData}"></div>`);
    } else if (qrCodeData.includes("conectado")) {
        res.write(`<div style="text-align:center;"><h1>BOT ACTIVO 24/7 ✅</h1><p>ONE4CARS funcionando.</p></div>`);
    } else {
        res.write(`<div style="text-align:center;"><h1>Iniciando...</h1></div>`);
    }
    res.end();
}).listen(process.env.PORT || 10000, '0.0.0.0', () => {
    console.log('Servidor web abierto en el puerto 10000');
});

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
    });
});

client.on('ready', () => {
    qrCodeData = "¡Bot de ONE4CARS conectado con éxito! ✅";
    console.log('Bot listo');
});

// RESPUESTAS AUTOMÁTICAS
client.on('message_create', async (msg) => {
    // Evitar que el bot se responda a sí mismo
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const texto = msg.body.toLowerCase().trim();

    // Lista de saludos unificada
    const saludos = [
        'hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 
        'buenosdias', 'buenosdías', 'bns dias', 'bns días', 'buenas tardes', 
        'buenas noches', 'buenas tarder', 'bns tarder'
    ];

    const esSaludo = saludos.some(s => texto.includes(s));

    if (esSaludo) {
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
    else if (texto.includes('medios de pago')) {
        await client.sendMessage(msg.from, '🏦 *MEDIOS DE PAGO*\n\n🔸 *Zelle:* pagos@one4cars.com\n🔸 *Pago Móvil:* Banesco, RIF J-12345678, Tel: 0412-1234567');
    }
    else if (texto.includes('estado de cuenta')) {
        await client.sendMessage(msg.from, '📄 *ESTADO DE CUENTA*\n\nPor favor, envíe su RIF o Nombre de empresa para enviarle su reporte.');
    }
    else if (texto.includes('lista de precios')) {
        await client.sendMessage(msg.from, '💰 *LISTA DE PRECIOS*\n\nAcceda aquí: [TU_LINK_AQUÍ]');
    }
    else if (texto.includes('tomar pedido')) {
        await client.sendMessage(msg.from, '🛒 *TOMAR PEDIDO*\n\nEscriba el código del producto y la cantidad deseada.');
    }
    else if (texto.includes('mis clientes')) {
        await client.sendMessage(msg.from, '👥 *MIS CLIENTES*\n\nExclusivo para vendedores. Ingrese su código de acceso.');
    }
    else if (texto.includes('ficha producto')) {
        await client.sendMessage(msg.from, '⚙️ *FICHA PRODUCTO*\n\nIndique el repuesto que desea consultar.');
    }
    else if (texto.includes('despacho')) {
        await client.sendMessage(msg.from, '🚚 *DESPACHO*\n\nIndique su número de factura para rastreo.');
    }
});

client.initialize();
