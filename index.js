const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Generación de QR para la web
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
    });
});

client.on('ready', () => {
    qrCodeData = "<h1>¡Bot de ONE4CARS conectado!</h1>";
    console.log('Bot listo');
});

// Lógica de Mensajería
client.on('message', async (msg) => {
    const mensajeUsuario = msg.body.toLowerCase().trim();

    // 1. LISTA DE SALUDOS (Triggers)
    const saludos = [
        'hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días',
        'buenosdias', 'buenosdías', 'bns dias', 'bns días', 'buenas tardes', 'buenas noches'
    ];

    // --- RESPUESTA: MENÚ PRINCIPAL ---
    if (saludos.some(s => mensajeUsuario === s)) {
        msg.reply(
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Para ayudarte de forma precisa, por favor escribe la *frase de la opción* que necesitas:\n\n' +
            '📲 *Menú de Gestión Comercial*\n' +
            '🏦 *Medios de Pago* — (Transferencia / Pago Móvil / Zelle)\n' +
            '📄 *Estado de Cuenta* — (Reporte detallado de facturas)\n' +
            '💰 *Lista de Precios* — (Listado de productos actualizado)\n' +
            '🛒 *Tomar Pedido* — (Cargar pedido de clientes)\n' +
            '👥 *Mis Clientes* — (Tu cartera de clientes asignada)\n' +
            '⚙️ *Ficha Producto* — (Consultar fichas técnicas)\n' +
            '🚚 *Despacho* — (Estatus y seguimiento de tu orden)'
        );
        return;
    }

    // --- RESPUESTA: MEDIOS DE PAGO ---
    if (mensajeUsuario.includes('medios de pago') || mensajeUsuario.includes('pago movil') || mensajeUsuario.includes('zelle')) {
        msg.reply(
            '🏦 *NUESTROS MEDIOS DE PAGO*\n\n' +
            '🔸 *Zelle:* (Ingresa tu correo aquí)\n' +
            '🔸 *Pago Móvil:* Banco (Nombre), RIF (J-0000), Tel: (04XX-0000000)\n' +
            '🔸 *Transferencias:* Cuentas Banesco / Mercantil (Solicitar números).\n\n' +
            '⚠️ _Recuerda enviar el comprobante por este mismo chat._'
        );
    }

    // --- RESPUESTA: ESTADO DE CUENTA ---
    else if (mensajeUsuario.includes('estado de cuenta')) {
        msg.reply(
            '📄 *CONSULTA DE ESTADO DE CUENTA*\n\n' +
            'Para enviarte tu reporte detallado, por favor facilítanos:\n' +
            '1. Nombre de la Empresa o RIF.\n' +
            '2. Código de cliente (si lo posee).\n\n' +
            '⏳ _En breve un ejecutivo validará tu información._'
        );
    }

    // --- RESPUESTA: LISTA DE PRECIOS ---
    else if (mensajeUsuario.includes('lista de precios')) {
        msg.reply(
            '💰 *LISTA DE PRECIOS ACTUALIZADA*\n\n' +
            'Puedes visualizar y descargar nuestro catálogo de precios aquí:\n' +
            '🔗 [TU_ENLACE_AQUÍ]\n\n' +
            '_Precios sujetos a cambios sin previo aviso._'
        );
    }

    // --- RESPUESTA: TOMAR PEDIDO ---
    else if (mensajeUsuario.includes('tomar pedido')) {
        msg.reply(
            '🛒 *MÓDULO DE PEDIDOS*\n\n' +
            'Para procesar tu compra rápida, indica:\n' +
            '✅ Código del producto\n' +
            '✅ Cantidad deseada\n\n' +
            'Si eres vendedor, recuerda especificar el nombre del cliente.'
        );
    }

    // --- RESPUESTA: MIS CLIENTES ---
    else if (mensajeUsuario.includes('mis clientes')) {
        msg.reply(
            '👥 *CARTERA DE CLIENTES*\n\n' +
            'Esta opción es exclusiva para asesores comerciales. Por favor, ingresa tu clave de acceso o solicita el reporte a supervisión.'
        );
    }

    // --- RESPUESTA: FICHA PRODUCTO ---
    else if (mensajeUsuario.includes('ficha producto')) {
        msg.reply(
            '⚙️ *FICHA TÉCNICA*\n\n' +
            '¿De qué producto deseas información? Contamos con:\n' +
            '🔹 Filtros / Bujías / Bombas\n' +
            '🔹 Rodamientos / Tren delantero\n\n' +
            'Escribe el nombre del repuesto o código SKU.'
        );
    }

    // --- RESPUESTA: DESPACHO ---
    else if (mensajeUsuario.includes('despacho')) {
        msg.reply(
            '🚚 *ESTATUS DE DESPACHO*\n\n' +
            'Para rastrear tu orden, indica el *Número de Factura* o *Pedido*.\n\n' +
            'Nuestro tiempo estimado de entrega es de 24 a 48 horas hábiles.'
        );
    }
});

// Mini servidor para ver el QR
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.startsWith("data:image")) {
        res.write(`<div style="text-align:center;"><h1>Escanea para conectar ONE4CARS</h1><img src="${qrCodeData}" style="width:300px;"></div>`);
    } else {
        res.write(qrCodeData || "<h1>Cargando QR... refresca en 10 segundos</h1>");
    }
    res.end();
}).listen(process.env.PORT || 3000);

client.initialize();
