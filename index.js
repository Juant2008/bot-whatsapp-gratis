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
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Servidor para Render y visor de QR
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<div style="text-align:center;font-family:Arial;"><h1>Escanea el QR de ONE4CARS</h1><img src="${qrCodeData}" style="width:300px;"></div>`);
    } else {
        res.write(`<div style="text-align:center;font-family:Arial;"><h1>${qrCodeData || "Iniciando sistema... refresca en 1 min."}</h1></div>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; }); });
client.on('ready', () => { qrCodeData = "BOT ONE4CARS CONECTADO ✅"; console.log('Online'); });

// LÓGICA DE RESPUESTA RÁPIDA
client.on('message_create', async (msg) => {
    // Evita que el bot se responda a sí mismo
    if (msg.fromMe && msg.body.includes("Bienvenido a ONE4CARS")) return;

    const texto = msg.body.toLowerCase().trim();

    // 1. DETECTOR DE SALUDOS (Activa el Menú de Apertura)
    const saludos = ['hola', 'buen dia', 'buen día', 'buendia', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos', 'bns dias'];
    const esSaludo = saludos.some(s => texto === s || texto.includes(s));

    if (esSaludo) {
        return msg.reply(
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Para ayudarte de forma precisa, por favor escribe la frase de la opción que necesitas:\n\n' +
            '¡Excelente! He actualizado tu menú de opciones incluyendo la nueva función para la carga de pedidos. Aquí tienes la lista organizada y profesional para tu canal de atención:\n\n' +
            '📲 *Menú de Gestión Comercial*\n' +
            '🏦 *Medios de Pago* — (Transferencia / Pago Móvil / Zelle)\n\n' +
            '📄 *Estado de Cuenta* — (Reporte detallado de facturas)\n\n' +
            '💰 *Lista de Precios* — (Listado de productos actualizado)\n\n' +
            '🛒 *Tomar Pedido* — (Cargar pedido de clientes)\n\n' +
            '👥 *Mis Clientes* — (Tu cartera de clientes asignada)\n\n' +
            '⚙️ *Ficha Producto* — (Consultar fichas técnicas)\n\n' +
            '🚚 *Despacho* — (Estatus y seguimiento de tu orden)\n\n' +
            '👤 *Asesor* — (Hablar con un humano)'
        );
    }

    // 2. RESPUESTAS AUTOMÁTICAS POR FRASES CLAVE
    if (texto.includes('medios de pago')) {
        return msg.reply('🏦 *MEDIOS DE PAGO*\n\n🔹 *Zelle:* (Tu Correo)\n🔹 *Pago Móvil:* Banesco, RIF J-00000000, Cel: 04XX-0000000\n🔹 *Transferencias:* Solicita los números aquí.');
    }

    if (texto.includes('estado de cuenta')) {
        return msg.reply('📄 *ESTADO DE CUENTA*\n\nPor favor, envíanos tu RIF o Nombre de empresa para generar tu reporte de facturas pendientes.');
    }

    if (texto.includes('lista de precios')) {
        return msg.reply('💰 *LISTA DE PRECIOS*\n\nPuedes descargar nuestra lista actualizada aquí:\n🔗 [PEGA AQUÍ TU LINK]');
    }

    if (texto.includes('tomar pedido')) {
        return msg.reply('🛒 *TOMAR PEDIDO*\n\nPor favor, indica el *Código del Producto* y la *Cantidad*. Nuestro equipo de ventas lo procesará de inmediato.');
    }

    if (texto.includes('mis clientes')) {
        return msg.reply('👥 *MIS CLIENTES*\n\nAcceso exclusivo para asesores. Por favor, ingresa tu código de vendedor para enviarte tu cartera asignada.');
    }

    if (texto.includes('ficha producto')) {
        return msg.reply('⚙️ *FICHA PRODUCTO*\n\nIndica el código o nombre del producto para enviarte las especificaciones técnicas.');
    }

    if (texto.includes('despacho')) {
        return msg.reply('🚚 *DESPACHO*\n\nIndica tu número de factura o nota de entrega para darte el estatus de tu orden.');
    }

    if (texto.includes('asesor')) {
        return msg.reply('👤 *ASESOR HUMANO*\n\nEntendido. He notificado a un asesor. En breve se comunicará contigo de forma manual. Espera un momento...');
    }
});

client.initialize();
