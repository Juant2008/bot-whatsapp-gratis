const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// Servidor Web para Hugging Face (Puerto 7860)
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center><h1 style="font-family:Arial;">Asistente ONE4CARS</h1><img src="${qrCodeData}" style="width:350px;border:10px solid white;box-shadow:0 0 15px rgba(0,0,0,0.1);"><p>Escanea con tu iPhone</p></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;">${qrCodeData || "Iniciando Servidor... Por favor refresca en 10 segundos."}</h1></center>`);
    }
    res.end();
}).listen(7860, '0.0.0.0');

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
    console.log("Nuevo QR generado");
});

client.on('ready', () => {
    qrCodeData = "¡BOT ONE4CARS CONECTADO! ✅";
    console.log('Bot listo');
});

// --- LÓGICA DE MENÚ ELABORADO ---
client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const texto = msg.body.toLowerCase().trim();
    const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes', 'buenas noches'];

    // 1. DISPARADOR DEL MENÚ PRINCIPAL
    if (saludos.some(s => texto === s || texto.includes(s)) && !texto.includes('pago')) {
        await client.sendMessage(msg.from, 
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Para ayudarte de forma precisa, por favor escribe la *frase exacta* de la opción que necesitas:\n\n' +
            '📲 *Menú de Gestión Comercial*\n\n' +
            '🏦 *Medios de Pago* — (Zelle / Pago Móvil)\n' +
            '📄 *Estado de Cuenta* — (Facturas pendientes)\n' +
            '💰 *Lista de Precios* — (Catálogo actualizado)\n' +
            '🛒 *Tomar Pedido* — (Cargar orden)\n' +
            '👥 *Mis Clientes* — (Cartera asignada)\n' +
            '⚙️ *Ficha Producto* — (Datos técnicos)\n' +
            '🚚 *Despacho* — (Estatus de orden)\n' +
            '👤 *Asesor* — (Hablar con un humano)'
        );
        return;
    }

    // 2. RESPUESTAS DETALLADAS
    if (texto.includes('medios de pago')) {
        await client.sendMessage(msg.from, '🏦 *MEDIOS DE PAGO*\n\n🔸 *Zelle:* pagos@one4cars.com\n🔸 *Pago Móvil:* Banesco (0134), RIF J-12345678, Tel: 0412-1234567\n\n_Por favor envía el comprobante por aquí._');
    } 
    else if (texto.includes('estado de cuenta')) {
        await client.sendMessage(msg.from, '📄 *ESTADO DE CUENTA*\n\nIndica tu RIF o Nombre de empresa para generar el reporte de facturas.');
    } 
    else if (texto.includes('lista de precios')) {
        await client.sendMessage(msg.from, '💰 *LISTA DE PRECIOS*\n\nDescárgala aquí: https://tu-link-aqui.com/precios');
    } 
    else if (texto.includes('tomar pedido')) {
        await client.sendMessage(msg.from, '🛒 *CARGA DE PEDIDO*\n\nIndica:\n1. Código del producto\n2. Cantidad\n\n_Ejemplo: FILT-001 x 10 unidades._');
    }
    else if (texto.includes('despacho')) {
        await client.sendMessage(msg.from, '🚚 *ESTATUS DE DESPACHO*\n\nIndica tu número de factura o pedido para rastrear el envío.');
    }
    else if (texto.includes('asesor')) {
        await client.sendMessage(msg.from, '👤 *ASESOR HUMANO*\n\nHe notificado a nuestro equipo. Un ejecutivo se pondrá en contacto contigo en breve de forma manual.');
    }
});

// Sistema de reintento para evitar el error de red al inicio
async function iniciar() {
    try {
        console.log("Iniciando conexión con WhatsApp...");
        await client.initialize();
    } catch (e) {
        console.error("Error de red, reintentando en 10 segundos...", e.message);
        setTimeout(iniciar, 10000);
    }
}

iniciar();
