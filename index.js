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

// --- SERVIDOR WEB PARA VER EL QR ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.startsWith("data:image")) {
        res.write(`
            <div style="text-align:center; font-family:sans-serif;">
                <h1>Escanea el QR para ONE4CARS</h1>
                <img src="${qrCodeData}" style="width:300px; border:10px solid white; box-shadow:0 0 10px rgba(0,0,0,0.2);">
                <p>Refresca esta página si el QR no carga.</p>
            </div>
        `);
    } else {
        res.write(`<div style="text-align:center;"><h1>${qrCodeData || "Generando QR... espera unos segundos."}</h1></div>`);
    }
    res.end();
}).listen(process.env.PORT || 3000);

// --- EVENTOS DE CONEXIÓN ---
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
        console.log("Nuevo QR generado. Míralo en el link de Render.");
    });
});

client.on('ready', () => {
    qrCodeData = "¡Bot de ONE4CARS conectado correctamente! ✅";
    console.log('Bot listo y funcionando');
});

// --- LÓGICA DE AUTO-RESPUESTA ---
client.on('message_create', async (msg) => {
    // Evitar que el bot responda a sus propios mensajes automáticos (evita bucles)
    if (msg.fromMe && msg.body.includes("Bienvenido a *ONE4CARS*")) return;

    const mensajeUsuario = msg.body.toLowerCase().trim();
    const chat = await msg.getChat();

    // LISTA DE SALUDOS (Triggers)
   const saludos = [
        'Buen dia', 'Buen día', 'buendia', 'Buendia', 'BuendÍa','buen dia', 'buen día', 'buenos dias', 'buenos días', 'Buenos Días', 'Buenosdias', 'BuenosdÍas',
        'buenosdias', 'buenosdías', 'bns dias', 'bns días', 'buenas tardes', 'Buenas tardes', 'Buenas Tardes', 'bns tardes','buenas noches','Buenos Dias', 'BUENDIA'
    ]; 


    // Verificar si el mensaje contiene algún saludo
    const esSaludo = saludos.some(s => mensajeUsuario.includes(s));

    // 1. MENÚ PRINCIPAL
    if (esSaludo) {
        console.log(`Enviando menú a: ${msg.from}`);
        await client.sendMessage(msg.from, 
            'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
            'Para ayudarte de forma precisa, por favor escribe la *frase* de la opción que necesitas:\n\n' +
            '🏦 *Medios de Pago* — (Transferencia / Pago Móvil / Zelle)\n' +
            '📄 *Estado de Cuenta* — (Reporte detallado de facturas)\n' +
            '💰 *Lista de Precios* — (Listado de productos actualizado)\n' +
            '🛒 *Tomar Pedido* — (Cargar pedido de clientes)\n' +
            '👥 *Mis Clientes* — (Tu cartera de clientes asignada)\n' +
            '⚙️ *Ficha Producto* — (Consultar fichas técnicas)\n' +
            '🚚 *Despacho* — (Estatus y seguimiento de tu orden)'
        );
    }

    // 2. OPCIÓN: MEDIOS DE PAGO
    else if (mensajeUsuario.includes('medios de pago')) {
        await client.sendMessage(msg.from, 
            '🏦 *MEDIOS DE PAGO ONE4CARS*\n\n' +
            '🔸 *Zelle:* pagos@one4cars.com\n' +
            '🔸 *Pago Móvil:* Banco Banesco, RIF J-12345678, Tel: 0412-1234567\n' +
            '🔸 *Transferencia:* Solicita los números de cuenta nacionales aquí.\n\n' +
            '_Por favor envíe el comprobante una vez realizado el pago._'
        );
    }

    // 3. OPCIÓN: ESTADO DE CUENTA
    else if (mensajeUsuario.includes('estado de cuenta')) {
        await client.sendMessage(msg.from, 
            '📄 *ESTADO DE CUENTA*\n\n' +
            'Para procesar su solicitud, indique por favor:\n' +
            '1. Nombre de la empresa o RIF.\n' +
            '2. Correo electrónico registrado.\n\n' +
            '⏳ _En breve un analista le enviará su reporte._'
        );
    }

    // 4. OPCIÓN: LISTA DE PRECIOS
    else if (mensajeUsuario.includes('lista de precios')) {
        await client.sendMessage(msg.from, 
            '💰 *LISTA DE PRECIOS*\n\n' +
            'Descargue nuestro listado actualizado en el siguiente enlace:\n' +
            '🔗 [Pega aquí tu link de Google Drive o Web]\n\n' +
            '_Precios sujetos a cambio sin previo aviso._'
        );
    }

    // 5. OPCIÓN: TOMAR PEDIDO
    else if (mensajeUsuario.includes('tomar pedido')) {
        await client.sendMessage(msg.from, 
            '🛒 *CARGA DE PEDIDOS*\n\n' +
            'Indique el código del producto y la cantidad deseada.\n' +
            'Ejemplo: *FILT-001 x 10 unidades*.\n\n' +
            'Nuestro equipo validará la disponibilidad de inmediato.'
        );
    }

    // 6. OPCIÓN: MIS CLIENTES
    else if (mensajeUsuario.includes('mis clientes')) {
        await client.sendMessage(msg.from, 
            '👥 *GESTIÓN DE CLIENTES*\n\n' +
            'Módulo para asesores comerciales. Por favor ingrese su código de vendedor para ver su cartera asignada.'
        );
    }

    // 7. OPCIÓN: FICHA PRODUCTO
    else if (mensajeUsuario.includes('ficha producto')) {
        await client.sendMessage(msg.from, 
            '⚙️ *FICHA TÉCNICA*\n\n' +
            'Por favor indique el nombre del repuesto o código de parte para enviarle las especificaciones técnicas.'
        );
    }

    // 8. OPCIÓN: DESPACHO
    else if (mensajeUsuario.includes('despacho')) {
        await client.sendMessage(msg.from, 
            '🚚 *ESTATUS DE DESPACHO*\n\n' +
            'Indique su número de factura o pedido para rastrear su envío.\n\n' +
            '📍 *Tiempo estimado:* 24 a 48 horas.'
        );
    }
});

client.initialize();
